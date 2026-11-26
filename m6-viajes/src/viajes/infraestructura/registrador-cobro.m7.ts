import { Logger } from '@nestjs/common';
import { RegistradorCobro } from '../aplicacion/puertos';
import { Viaje } from '../dominio/viaje';

/**
 * Le avisa a M7 (Tarifas, Pagos y Liquidaciones) lo que tiene que cobrar.
 * Contrato común de M7 (Grupos 6 y 11), en el repo de la cátedra: contratos/m7_tarifas/openapi.yml.
 *
 * Al completar el viaje:
 *   1. POST /api/v1/tarifas/viajes/{viaje_id}/tarifa-final  { tipo_vehiculo, distancia_real_km, duracion_real_min }
 *      201 → el total viene en la respuesta; 409 (ya registrada) → se lee con GET de la misma ruta.
 *   2. POST /api/v1/pagos  { viaje_id, reserva_id?, cliente_id, beneficiario_id, monto }  con Idempotency-Key
 * Al cancelar con cargo (regla R6-05):
 *   POST /api/v1/cargos-cancelacion  { viaje_id, reserva_id?, cliente_id, tipo_vehiculo, motivo }  con Idempotency-Key
 *
 * No se manda `metodo` (medio de pago): lo elige el cliente en M7 (RF-7.2). Así se lo propusimos al
 * Grupo 6 (docs/para-grupo-6-integracion-m7.md, decisión A).
 *
 * Se apunta a un solo M7 (M7_URL): registrar en los dos duplicaría el cobro.
 * Nunca lanza ni espera indefinidamente (RNF-13): si M7 falla, el viaje igual queda completado o
 * cancelado y se deja el error en el log. No se reintenta.
 */
export class RegistradorCobroM7 implements RegistradorCobro {
  private readonly logger = new Logger(RegistradorCobroM7.name);
  private readonly urlBase: string;

  constructor(
    urlBase: string,
    private readonly timeoutMs: number,
    private readonly tokenServicio?: string,
  ) {
    this.urlBase = urlBase.replace(/\/+$/, '');
  }

  async viajeCompletado(viaje: Viaje, correlationId: string): Promise<void> {
    const { id, reservationId, clientId, driverId, vehicleType, closure } = viaje.toProps();
    if (!closure) return;

    const rutaTarifa = `/api/v1/tarifas/viajes/${id}/tarifa-final`;
    let tarifa = await this.pedir('POST', rutaTarifa, correlationId, {
      tipo_vehiculo: vehicleType.toLowerCase(),
      distancia_real_km: closure.distanceKm,
      // M7 trabaja en minutos y exige más de 0.
      duracion_real_min: Math.max(Math.round((closure.durationSeconds / 60) * 100) / 100, 0.01),
    });
    if (tarifa?.status === 409) {
      // Ya estaba registrada (hay una sola por viaje): se lee para saber el total.
      tarifa = await this.pedir('GET', rutaTarifa, correlationId);
    }
    if (!tarifa?.ok) {
      this.fallo('registrar la tarifa final', id, tarifa);
      return;
    }
    const total = ((await tarifa.json().catch(() => null)) as { desglose?: { total?: number } } | null)?.desglose?.total;
    if (typeof total !== 'number') {
      this.logger.error(`M7 no devolvió el total de la tarifa final del viaje ${id}; no se registra el pago`);
      return;
    }

    const pago = await this.pedir(
      'POST',
      '/api/v1/pagos',
      correlationId,
      { viaje_id: id, ...(reservationId ? { reserva_id: reservationId } : {}), cliente_id: clientId, beneficiario_id: driverId, monto: total },
      `m6-pago-${id}`,
    );
    if (!aceptado(pago)) this.fallo('registrar el pago', id, pago);
  }

  async cargoCancelacion(viaje: Viaje, correlationId: string): Promise<void> {
    const { id, reservationId, clientId, vehicleType, cancellation } = viaje.toProps();
    if (!cancellation) return;

    const cargo = await this.pedir(
      'POST',
      '/api/v1/cargos-cancelacion',
      correlationId,
      {
        viaje_id: id,
        ...(reservationId ? { reserva_id: reservationId } : {}),
        cliente_id: clientId,
        tipo_vehiculo: vehicleType.toLowerCase(),
        motivo: cancellation.reason,
      },
      `m6-cargo-${id}`,
    );
    if (!aceptado(cargo)) this.fallo('registrar el cargo de cancelación', id, cargo);
  }

  /** Hace el pedido; si M7 no responde devuelve null (el error lo registra quien llama). */
  private async pedir(
    metodo: 'GET' | 'POST',
    ruta: string,
    correlationId: string,
    cuerpo?: object,
    claveIdempotencia?: string,
  ): Promise<Response | null> {
    const headers: Record<string, string> = { 'X-Request-Id': correlationId };
    if (cuerpo) headers['Content-Type'] = 'application/json';
    if (claveIdempotencia) headers['Idempotency-Key'] = claveIdempotencia;
    if (this.tokenServicio) headers.Authorization = `Bearer ${this.tokenServicio}`;
    try {
      return await fetch(this.urlBase + ruta, {
        method: metodo,
        headers,
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      this.logger.error(`M7 no respondió a ${metodo} ${ruta}: ${String(error)}`);
      return null;
    }
  }

  private fallo(accion: string, tripId: string, respuesta: Response | null): void {
    if (respuesta) {
      this.logger.error(`M7 respondió ${respuesta.status} al ${accion} del viaje ${tripId}`);
    }
    // Sin respuesta: ya quedó registrado en pedir().
  }
}

/** 201 registrado, 200 la misma Idempotency-Key ya usada, 409 ya existía: en los tres casos M7 ya lo tiene. */
function aceptado(respuesta: Response | null): boolean {
  return !!respuesta && (respuesta.ok || respuesta.status === 409);
}
