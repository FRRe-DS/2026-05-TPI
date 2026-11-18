import { metrics, SpanStatusCode, trace } from '@opentelemetry/api';
import { AccionViaje, TransicionViaje } from '../viajes/dominio/tipos';

/**
 * Métricas propias de M6 y spans de las operaciones del ciclo de vida.
 *
 * Si OpenTelemetry no está activo (sin OTEL_EXPORTER_OTLP_ENDPOINT, o en los tests), la API
 * devuelve instrumentos "vacíos": todo funciona igual y no cuesta nada.
 *
 * Convención de nombres (docs de opsboard: convencion-metricas.md): prefijo `m6_`. Prometheus agrega
 * solo los sufijos `_total` (contadores) y `_seconds` (unidad s) al recibirlas.
 * Las etiquetas son siempre categorías cerradas: NUNCA un id de viaje o de usuario, porque cada
 * valor distinto crearía una serie nueva en Prometheus.
 */
const medidor = metrics.getMeter('m6-viajes');
const trazador = trace.getTracer('m6-viajes');

/** Métrica 1: viajes por transición de estado (de qué estado a cuál y quién la hizo). */
const transiciones = medidor.createCounter('m6_trip_transitions', {
  description: 'Transiciones de estado de viajes, por estado de origen, de destino y rol del actor',
});

/** Métrica 2: cancelaciones, por quién canceló y el motivo. */
const cancelaciones = medidor.createCounter('m6_trip_cancellations', {
  description: 'Viajes cancelados, por rol que canceló y motivo',
});

/** Métrica 3: cuánto tarda cada operación del ciclo de vida (incluye la validación del QR con M8 en `start`). */
const duracion = medidor.createHistogram('m6_transition_duration', {
  description: 'Duración de las operaciones del ciclo de vida del viaje',
  unit: 's',
  // Los buckets por defecto de OpenTelemetry están pensados para milisegundos; acá medimos en segundos.
  advice: { explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] },
});

/** Cuenta una transición ya guardada (métricas 1 y 2). */
export function registrarTransicion(t: TransicionViaje): void {
  transiciones.add(1, { from: t.from ?? 'NONE', to: t.to, actor: t.actor.role });
  if (t.action === AccionViaje.CANCEL) {
    cancelaciones.add(1, { actor: t.actor.role, reason: t.reason ?? 'UNKNOWN' });
  }
}

/** Ejecuta una operación dentro de un span y mide su duración (métrica 3). */
export function medirOperacion<T>(operacion: AccionViaje, tripId: string | undefined, funcion: () => Promise<T>): Promise<T> {
  return trazador.startActiveSpan(`trip.${operacion}`, { attributes: { 'trip.action': operacion, ...(tripId && { 'trip.id': tripId }) } }, async (span) => {
    const inicio = process.hrtime.bigint();
    let resultado = 'ok';
    try {
      return await funcion();
    } catch (error) {
      resultado = 'error';
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    } finally {
      duracion.record(Number(process.hrtime.bigint() - inicio) / 1e9, { action: operacion, resultado });
      span.end();
    }
  });
}

/** Ejecuta `funcion` dentro de un span con nombre propio (por ejemplo, la validación del QR con M8). */
export function conSpan<T>(nombre: string, funcion: () => Promise<T>): Promise<T> {
  return trazador.startActiveSpan(nombre, async (span) => {
    try {
      return await funcion();
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  });
}
