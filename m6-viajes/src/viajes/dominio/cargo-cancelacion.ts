import { DatosCancelacion, EstadoViaje, MotivoCancelacion, Rol } from './tipos';

/**
 * Regla R6-05: cuándo una cancelación lleva cargo (RF-6.6, RF-7.4). El importe lo calcula M7.
 * - Cancela el cliente cuando el conductor ya llegó.
 * - Cancela el conductor porque el cliente no se presentó.
 * En los demás casos (antes del arribo, otro motivo del conductor, el operador) no hay cargo.
 */
export function correspondeCargoCancelacion(cancelacion: DatosCancelacion | null): boolean {
  if (!cancelacion) return false;
  if (cancelacion.cancelledBy === Rol.CLIENT) {
    return cancelacion.previousState === EstadoViaje.DRIVER_ARRIVED;
  }
  if (cancelacion.cancelledBy === Rol.DRIVER) {
    return cancelacion.reason === MotivoCancelacion.CLIENT_NO_SHOW;
  }
  return false;
}
