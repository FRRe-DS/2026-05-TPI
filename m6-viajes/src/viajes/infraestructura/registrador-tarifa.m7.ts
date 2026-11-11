import { Logger } from '@nestjs/common';
import { RegistradorTarifaFinal } from '../aplicacion/puertos';
import { Viaje } from '../dominio/viaje';

/**
 * Registra la tarifa final del viaje en M7 (Tarifas, Pagos y Liquidaciones) cuando se completa.
 *
 * Contrato común de M7 (Grupos 6 y 11), en el repo de la cátedra: contratos/m7_tarifas/openapi.yml
 *   POST /api/v1/tarifas/viajes/{viaje_id}/tarifa-final
 *   { tipo_vehiculo: "auto" | "moto", distancia_real_km, duracion_real_min }
 *   → 201 registrada | 409 ya estaba registrada | 422 sin regla de tarifa activa
 *
 * Se apunta a un solo M7 (M7_URL): registrar en los dos duplicaría el cobro.
 * Nunca lanza ni espera indefinidamente (RNF-13): si M7 falla, el viaje igual queda completado y se
 * deja el error en el log.
 */
export class RegistradorTarifaM7 implements RegistradorTarifaFinal {
  private readonly logger = new Logger(RegistradorTarifaM7.name);
  private readonly urlBase: string;

  constructor(
    urlBase: string,
    private readonly timeoutMs: number,
    private readonly tokenServicio?: string,
  ) {
    this.urlBase = urlBase.replace(/\/+$/, '');
  }

  async registrar(viaje: Viaje, correlationId: string): Promise<void> {
    const { id, vehicleType, closure } = viaje.toProps();
    if (!closure) return;

    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Request-Id': correlationId };
    if (this.tokenServicio) {
      headers.Authorization = `Bearer ${this.tokenServicio}`;
    }
    const cuerpo = {
      tipo_vehiculo: vehicleType.toLowerCase(),
      distancia_real_km: closure.distanceKm,
      // M7 trabaja en minutos y exige más de 0.
      duracion_real_min: Math.max(Math.round((closure.durationSeconds / 60) * 100) / 100, 0.01),
    };

    try {
      const respuesta = await fetch(`${this.urlBase}/api/v1/tarifas/viajes/${id}/tarifa-final`, {
        method: 'POST',
        headers,
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (respuesta.ok || respuesta.status === 409) {
        // 409: M7 ya tenía la tarifa final de este viaje (hay una sola por viaje).
        return;
      }
      const detalle = await respuesta.text().catch(() => '');
      this.logger.error(`M7 respondió ${respuesta.status} al registrar la tarifa final del viaje ${id}: ${detalle}`);
    } catch (error) {
      this.logger.error(`M7 no respondió al registrar la tarifa final del viaje ${id}: ${String(error)}`);
    }
  }
}
