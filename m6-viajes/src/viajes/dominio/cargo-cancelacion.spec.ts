import { correspondeCargoCancelacion } from './cargo-cancelacion';
import { DatosCancelacion, EstadoViaje, MotivoCancelacion, Rol } from './tipos';

const cancelacion = (cancelledBy: Rol, previousState: EstadoViaje, reason: MotivoCancelacion): DatosCancelacion => ({
  cancelledBy,
  actorId: 'x',
  reason,
  previousState,
  requiresRedispatch: false,
});

describe('Regla R6-05: cargo de cancelación', () => {
  it.each([
    [Rol.CLIENT, EstadoViaje.DRIVER_ARRIVED, MotivoCancelacion.CHANGE_OF_PLANS, true],
    [Rol.CLIENT, EstadoViaje.PENDING_ARRIVAL, MotivoCancelacion.CHANGE_OF_PLANS, false],
    [Rol.DRIVER, EstadoViaje.DRIVER_ARRIVED, MotivoCancelacion.CLIENT_NO_SHOW, true],
    [Rol.DRIVER, EstadoViaje.DRIVER_ARRIVED, MotivoCancelacion.VEHICLE_PROBLEM, false],
    [Rol.DRIVER, EstadoViaje.PENDING_ARRIVAL, MotivoCancelacion.ORIGIN_UNREACHABLE, false],
    [Rol.OPERATOR, EstadoViaje.DRIVER_ARRIVED, MotivoCancelacion.SECURITY_INCIDENT, false],
    [Rol.OPERATOR, EstadoViaje.IN_PROGRESS, MotivoCancelacion.ADMINISTRATIVE_BLOCK, false],
  ])('cancela %s desde %s con %s → cargo: %s', (rol, estado, motivo, esperado) => {
    expect(correspondeCargoCancelacion(cancelacion(rol, estado, motivo))).toBe(esperado);
  });

  it('sin cancelación no hay cargo', () => {
    expect(correspondeCargoCancelacion(null)).toBe(false);
  });
});
