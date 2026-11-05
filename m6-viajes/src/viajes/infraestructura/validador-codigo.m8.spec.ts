import { Logger } from '@nestjs/common';
import { DependenciaNoDisponibleError } from '../aplicacion/errores';
import { ProveedorQrM8, proveedoresDesdeEntorno, ValidadorCodigoM8 } from './validador-codigo.m8';

const VIAJE = '0b6f1c1e-7a52-4f0e-9a3f-2d6f4a1b9c10';
const OTRO_VIAJE = '9d1e2f3a-1111-4222-8333-444455556666';
const G7 = 'http://m8-g7';
const G10 = 'http://m8-g10';

type Respuesta = { status: number; cuerpo?: unknown } | 'TIMEOUT';

/** Reemplaza fetch: cada URL base responde lo que se le indique y se guardan los pedidos. */
function simularM8(respuestas: Record<string, Respuesta>) {
  const pedidos: { url: string; init: RequestInit }[] = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (entrada, init) => {
    const url = String(entrada);
    pedidos.push({ url, init: init ?? {} });
    const base = Object.keys(respuestas).find((b) => url.startsWith(b));
    const r = base ? respuestas[base] : 'TIMEOUT';
    if (r === 'TIMEOUT') throw new DOMException('timeout', 'TimeoutError');
    return new Response(r.cuerpo === undefined ? null : JSON.stringify(r.cuerpo), { status: r.status });
  });
  return pedidos;
}

function validador(variantes: ('g7' | 'g10')[] = ['g7', 'g10'], extra: Record<string, string> = {}) {
  const env: Record<string, string> = {
    M8_PROVEEDORES: variantes.join(','),
    M8_G7_URL: G7,
    M8_G10_URL: G10,
    ...extra,
  };
  return new ValidadorCodigoM8(proveedoresDesdeEntorno((n) => env[n], 2000));
}

describe('ValidadorCodigoM8 (Grupos 7 y 10)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('manda a cada M8 su ruta y su formato de cuerpo', async () => {
    const pedidos = simularM8({ [G7]: { status: 404 }, [G10]: { status: 200, cuerpo: { valid: true, tripId: VIAJE } } });

    await validador(['g7', 'g10'], { M8_G7_TOKEN: 'jwt-g7' }).validarYConsumir(VIAJE, 'tok', 'corr-1');

    const g7 = pedidos.find((p) => p.url.startsWith(G7))!;
    const g10 = pedidos.find((p) => p.url.startsWith(G10))!;
    expect(g7.url).toBe(`${G7}/api/v1/qr/validaciones`);
    expect(JSON.parse(String(g7.init.body))).toEqual({ token: 'tok', viajeId: VIAJE });
    expect(g10.url).toBe(`${G10}/api/v1/documents/qr/verify`);
    expect(JSON.parse(String(g10.init.body))).toEqual({ token: 'tok', tripId: VIAJE });

    const h7 = g7.init.headers as Record<string, string>;
    expect(h7.Authorization).toBe('Bearer jwt-g7');
    expect(h7['X-Request-Id']).toBe('corr-1');
    expect(h7['Idempotency-Key']).toMatch(/^m6-qr-[0-9a-f]{32}$/);
    expect((g10.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('usa la ruta configurada con M8_G7_RUTA_QR', async () => {
    const pedidos = simularM8({ [G7]: { status: 200, cuerpo: { valido: true, viajeId: VIAJE } } });
    await validador(['g7'], { M8_G7_RUTA_QR: '/api/Documentos/qr/validar' }).validarYConsumir(VIAJE, 'tok', 'c');
    expect(pedidos[0].url).toBe(`${G7}/api/Documentos/qr/validar`);
  });

  it('G7: un 200 sin booleano (como dice su contrato) es válido', async () => {
    simularM8({ [G7]: { status: 200, cuerpo: { qrId: 'x', viajeId: VIAJE, usadoEn: '2026-11-05T10:00:00Z' } }, [G10]: { status: 404 } });
    await expect(validador().validarYConsumir(VIAJE, 'tok', 'c')).resolves.toBe('VALIDO');
  });

  it('G10: 200 { valid: true } es válido', async () => {
    simularM8({ [G7]: { status: 404 }, [G10]: { status: 200, cuerpo: { valid: true, tripId: VIAJE } } });
    await expect(validador().validarYConsumir(VIAJE, 'tok', 'c')).resolves.toBe('VALIDO');
  });

  it('rechaza un 200 cuyo viaje no coincide (el código del G7 no lo controla)', async () => {
    simularM8({ [G7]: { status: 200, cuerpo: { valido: true, viajeId: OTRO_VIAJE } }, [G10]: { status: 404 } });
    await expect(validador().validarYConsumir(VIAJE, 'tok', 'c')).resolves.toBe('INVALIDO');
  });

  it.each([400, 409, 410, 422])('un %i (usado, vencido, de otro viaje) es inválido', async (status) => {
    simularM8({ [G7]: { status }, [G10]: { status: 404 } });
    await expect(validador().validarYConsumir(VIAJE, 'tok', 'c')).resolves.toBe('INVALIDO');
  });

  it('si ninguno lo conoce (404 en ambos) es inválido', async () => {
    simularM8({ [G7]: { status: 404 }, [G10]: { status: 404 } });
    await expect(validador().validarYConsumir(VIAJE, 'tok', 'c')).resolves.toBe('INVALIDO');
  });

  it('si uno lo acepta, no importa que el otro esté caído', async () => {
    simularM8({ [G7]: 'TIMEOUT', [G10]: { status: 200, cuerpo: { valid: true, tripId: VIAJE } } });
    await expect(validador().validarYConsumir(VIAJE, 'tok', 'c')).resolves.toBe('VALIDO');
  });

  it('si nadie lo reconoce y uno está caído, devuelve 503 (el QR podría ser de ese)', async () => {
    simularM8({ [G7]: { status: 404 }, [G10]: 'TIMEOUT' });
    await expect(validador().validarYConsumir(VIAJE, 'tok', 'c')).rejects.toBeInstanceOf(DependenciaNoDisponibleError);
  });

  it.each([401, 403, 500, 503])('un %i no es culpa del QR: devuelve 503', async (status) => {
    simularM8({ [G7]: { status } });
    await expect(validador(['g7']).validarYConsumir(VIAJE, 'tok', 'c')).rejects.toBeInstanceOf(DependenciaNoDisponibleError);
  });

  it('la clave de idempotencia es la misma al reintentar el mismo QR', async () => {
    const pedidos = simularM8({ [G10]: { status: 200, cuerpo: { valid: true, tripId: VIAJE } } });
    const v = validador(['g10']);
    await v.validarYConsumir(VIAJE, 'tok', 'a');
    await v.validarYConsumir(VIAJE, 'tok', 'b');
    const claves = pedidos.map((p) => (p.init.headers as Record<string, string>)['Idempotency-Key']);
    expect(claves[0]).toBe(claves[1]);
  });

  it('no se puede armar sin proveedores', () => {
    expect(() => new ValidadorCodigoM8([] as ProveedorQrM8[])).toThrow();
  });
});
