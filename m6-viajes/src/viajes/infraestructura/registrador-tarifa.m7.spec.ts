import { Logger } from '@nestjs/common';
import { Rol, TipoVehiculo } from '../dominio/tipos';
import { Viaje } from '../dominio/viaje';
import { RegistradorTarifaM7 } from './registrador-tarifa.m7';

const VIAJE = '7b0e3a8e-4f7c-4d1a-9a52-1f0c2f9d6b11';
const M7 = 'http://m7';
const CONDUCTOR = { role: Rol.DRIVER, id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' };
const T0 = new Date('2026-11-11T12:00:00Z');
const minutos = (n: number) => new Date(T0.getTime() + n * 60_000);

function viajeCompletado(duracionMin = 15, tipo = TipoVehiculo.MOTO): Viaje {
  const v = Viaje.crear(
    {
      id: VIAJE,
      requestId: '0c6a4f0e-8f43-4d3b-a3b7-6a1f2c8e9d10',
      clientId: '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
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
  v.iniciar(CONDUCTOR, minutos(2));
  v.finalizar(CONDUCTOR, { distanceKm: 4.2 }, minutos(2 + duracionMin));
  return v;
}

/** Reemplaza fetch con la respuesta indicada y guarda los pedidos. */
function simularM7(respuesta: { status: number } | 'TIMEOUT') {
  const pedidos: { url: string; init: RequestInit }[] = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (entrada, init) => {
    pedidos.push({ url: String(entrada), init: init ?? {} });
    if (respuesta === 'TIMEOUT') throw new DOMException('timeout', 'TimeoutError');
    return new Response(null, { status: respuesta.status });
  });
  return pedidos;
}

describe('RegistradorTarifaM7 (contrato común de M7, Grupos 6 y 11)', () => {
  let errores: jest.SpyInstance;
  beforeEach(() => {
    errores = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('manda la ruta, el cuerpo y los encabezados del contrato', async () => {
    const pedidos = simularM7({ status: 201 });

    await new RegistradorTarifaM7(`${M7}/`, 2000, 'jwt-m6').registrar(viajeCompletado(), 'corr-1');

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].url).toBe(`${M7}/api/v1/tarifas/viajes/${VIAJE}/tarifa-final`);
    expect(pedidos[0].init.method).toBe('POST');
    expect(JSON.parse(String(pedidos[0].init.body))).toEqual({
      tipo_vehiculo: 'moto',
      distancia_real_km: 4.2,
      duracion_real_min: 15,
    });
    const headers = pedidos[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer jwt-m6');
    expect(headers['X-Request-Id']).toBe('corr-1');
    expect(errores).not.toHaveBeenCalled();
  });

  it('nunca manda 0 minutos (M7 exige más de 0)', async () => {
    const pedidos = simularM7({ status: 201 });

    await new RegistradorTarifaM7(M7, 2000).registrar(viajeCompletado(0, TipoVehiculo.AUTO), 'corr-1');

    const cuerpo = JSON.parse(String(pedidos[0].init.body));
    expect(cuerpo.tipo_vehiculo).toBe('auto');
    expect(cuerpo.duracion_real_min).toBeGreaterThan(0);
    expect((pedidos[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('toma el 409 como "ya registrada" y no lo trata como error', async () => {
    simularM7({ status: 409 });
    await new RegistradorTarifaM7(M7, 2000).registrar(viajeCompletado(), 'corr-1');
    expect(errores).not.toHaveBeenCalled();
  });

  it.each([{ status: 422 }, { status: 500 }, 'TIMEOUT' as const])('si M7 falla (%p) no lanza y deja el error en el log', async (r) => {
    simularM7(r);
    await expect(new RegistradorTarifaM7(M7, 2000).registrar(viajeCompletado(), 'corr-1')).resolves.toBeUndefined();
    expect(errores).toHaveBeenCalledTimes(1);
  });
});
