import { Logger } from '@nestjs/common';
import { MotivoCancelacion, Rol, TipoVehiculo } from '../dominio/tipos';
import { Viaje } from '../dominio/viaje';
import { RegistradorCobroM7 } from './registrador-cobro.m7';

const VIAJE = '7b0e3a8e-4f7c-4d1a-9a52-1f0c2f9d6b11';
const RESERVA = '5c4b3a29-1807-4f6e-9d5c-4b3a2f1e0d9c';
const CLIENTE = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const CONDUCTOR = { role: Rol.DRIVER, id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' };
const M7 = 'http://m7';
const RUTA_TARIFA = `${M7}/api/v1/tarifas/viajes/${VIAJE}/tarifa-final`;
const T0 = new Date('2026-11-11T12:00:00Z');
const minutos = (n: number) => new Date(T0.getTime() + n * 60_000);

function viajeArribado(tipo = TipoVehiculo.MOTO, reservationId: string | null = null): Viaje {
  const v = Viaje.crear(
    {
      id: VIAJE,
      requestId: '0c6a4f0e-8f43-4d3b-a3b7-6a1f2c8e9d10',
      reservationId,
      clientId: CLIENTE,
      driverId: CONDUCTOR.id,
      vehicleId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5e',
      vehicleType: tipo,
      originLatitude: -27.45,
      originLongitude: -58.98,
      destinationLatitude: -27.47,
      destinationLongitude: -58.99,
    },
    { role: Rol.SYSTEM, id: 'm5' },
    T0,
  );
  v.registrarArribo(CONDUCTOR, minutos(1));
  return v;
}

function viajeCompletado(duracionMin = 15, tipo = TipoVehiculo.MOTO, reservationId: string | null = null): Viaje {
  const v = viajeArribado(tipo, reservationId);
  v.iniciar(CONDUCTOR, minutos(2));
  v.finalizar(CONDUCTOR, { distanceKm: 4.2 }, minutos(2 + duracionMin));
  return v;
}

type Respuesta = { status: number; cuerpo?: unknown } | 'TIMEOUT';
const TARIFA = { status: 201, cuerpo: { viaje_id: VIAJE, desglose: { total: 1760.5 } } };

/** Reemplaza fetch: cada "MÉTODO URL" responde lo indicado; se guardan los pedidos en orden. */
function simularM7(respuestas: Record<string, Respuesta>) {
  const pedidos: { clave: string; init: RequestInit }[] = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (entrada, init) => {
    const clave = `${init?.method ?? 'GET'} ${String(entrada)}`;
    pedidos.push({ clave, init: init ?? {} });
    const r = respuestas[clave] ?? 'TIMEOUT';
    if (r === 'TIMEOUT') throw new DOMException('timeout', 'TimeoutError');
    return new Response(r.cuerpo === undefined ? null : JSON.stringify(r.cuerpo), { status: r.status });
  });
  return pedidos;
}

const cuerpo = (p: { init: RequestInit }) => JSON.parse(String(p.init.body));
const headers = (p: { init: RequestInit }) => p.init.headers as Record<string, string>;

describe('RegistradorCobroM7 (contrato común de M7, Grupos 6 y 11)', () => {
  let errores: jest.SpyInstance;
  beforeEach(() => {
    errores = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('viaje completado', () => {
    it('registra la tarifa final y después el pago por su total', async () => {
      const pedidos = simularM7({
        [`POST ${RUTA_TARIFA}`]: TARIFA,
        [`POST ${M7}/api/v1/pagos`]: { status: 201 },
      });

      await new RegistradorCobroM7(`${M7}/`, 2000, 'jwt-m6').viajeCompletado(viajeCompletado(), 'corr-1');

      expect(pedidos.map((p) => p.clave)).toEqual([`POST ${RUTA_TARIFA}`, `POST ${M7}/api/v1/pagos`]);
      expect(cuerpo(pedidos[0])).toEqual({ tipo_vehiculo: 'moto', distancia_real_km: 4.2, duracion_real_min: 15 });
      // Sin `metodo` (decisión A) y sin reserva_id cuando el viaje no viene de una reserva.
      expect(cuerpo(pedidos[1])).toEqual({
        viaje_id: VIAJE,
        cliente_id: CLIENTE,
        beneficiario_id: CONDUCTOR.id,
        monto: 1760.5,
      });
      expect(headers(pedidos[1])['Idempotency-Key']).toBe(`m6-pago-${VIAJE}`);
      expect(headers(pedidos[1]).Authorization).toBe('Bearer jwt-m6');
      expect(headers(pedidos[1])['X-Request-Id']).toBe('corr-1');
      expect(errores).not.toHaveBeenCalled();
    });

    it('manda reserva_id si el viaje viene de una reserva y nunca 0 minutos', async () => {
      const pedidos = simularM7({
        [`POST ${RUTA_TARIFA}`]: TARIFA,
        [`POST ${M7}/api/v1/pagos`]: { status: 201 },
      });

      await new RegistradorCobroM7(M7, 2000).viajeCompletado(viajeCompletado(0, TipoVehiculo.AUTO, RESERVA), 'corr-1');

      expect(cuerpo(pedidos[0]).tipo_vehiculo).toBe('auto');
      expect(cuerpo(pedidos[0]).duracion_real_min).toBeGreaterThan(0);
      expect(cuerpo(pedidos[1]).reserva_id).toBe(RESERVA);
      expect(headers(pedidos[0]).Authorization).toBeUndefined();
    });

    it('si la tarifa ya estaba registrada (409) lee el total y registra el pago', async () => {
      const pedidos = simularM7({
        [`POST ${RUTA_TARIFA}`]: { status: 409 },
        [`GET ${RUTA_TARIFA}`]: { status: 200, cuerpo: TARIFA.cuerpo },
        [`POST ${M7}/api/v1/pagos`]: { status: 409 },
      });

      await new RegistradorCobroM7(M7, 2000).viajeCompletado(viajeCompletado(), 'corr-1');

      expect(pedidos.map((p) => p.clave)).toEqual([`POST ${RUTA_TARIFA}`, `GET ${RUTA_TARIFA}`, `POST ${M7}/api/v1/pagos`]);
      expect(cuerpo(pedidos[2]).monto).toBe(1760.5);
      expect(errores).not.toHaveBeenCalled();
    });

    it.each([{ status: 422 }, { status: 500 }, 'TIMEOUT' as const])(
      'si la tarifa falla (%p) no registra el pago, no lanza y deja el error en el log',
      async (r) => {
        const pedidos = simularM7({ [`POST ${RUTA_TARIFA}`]: r });
        await expect(new RegistradorCobroM7(M7, 2000).viajeCompletado(viajeCompletado(), 'c')).resolves.toBeUndefined();
        expect(pedidos).toHaveLength(1);
        expect(errores).toHaveBeenCalledTimes(1);
      },
    );

    it('si el pago falla no lanza y deja el error en el log', async () => {
      simularM7({ [`POST ${RUTA_TARIFA}`]: TARIFA, [`POST ${M7}/api/v1/pagos`]: { status: 422 } });
      await expect(new RegistradorCobroM7(M7, 2000).viajeCompletado(viajeCompletado(), 'c')).resolves.toBeUndefined();
      expect(errores).toHaveBeenCalledTimes(1);
    });
  });

  describe('cargo de cancelación', () => {
    it('manda el cuerpo del contrato, sin metodo, con Idempotency-Key fija por viaje', async () => {
      const pedidos = simularM7({ [`POST ${M7}/api/v1/cargos-cancelacion`]: { status: 201 } });
      const v = viajeArribado(TipoVehiculo.AUTO);
      v.cancelar(
        { role: Rol.CLIENT, id: CLIENTE },
        { reason: MotivoCancelacion.CHANGE_OF_PLANS },
        minutos(3),
        { esperaMinimaArriboMinutos: 5 },
      );

      await new RegistradorCobroM7(M7, 2000).cargoCancelacion(v, 'corr-2');

      expect(pedidos).toHaveLength(1);
      expect(cuerpo(pedidos[0])).toEqual({
        viaje_id: VIAJE,
        cliente_id: CLIENTE,
        tipo_vehiculo: 'auto',
        motivo: 'CHANGE_OF_PLANS',
      });
      expect(headers(pedidos[0])['Idempotency-Key']).toBe(`m6-cargo-${VIAJE}`);
      expect(errores).not.toHaveBeenCalled();
    });

    it('si M7 no responde no lanza y deja el error en el log', async () => {
      simularM7({});
      const v = viajeArribado();
      v.cancelar({ role: Rol.CLIENT, id: CLIENTE }, { reason: MotivoCancelacion.OTHER }, minutos(3), {
        esperaMinimaArriboMinutos: 5,
      });
      await expect(new RegistradorCobroM7(M7, 2000).cargoCancelacion(v, 'c')).resolves.toBeUndefined();
      expect(errores).toHaveBeenCalledTimes(1);
    });
  });
});
