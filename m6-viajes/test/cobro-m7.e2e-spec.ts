import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { RegistradorCobro } from '../src/viajes/aplicacion/puertos';
import { bearer, crearApp, cuerpoCrearViaje, nuevosIds } from './app-de-prueba';

const M5 = bearer('SYSTEM', 'm5-despacho');

/** Cuándo avisa M6 a M7 (el cliente HTTP de M7 se prueba en registrador-cobro.m7.spec.ts). */
describe('Avisos de cobro a M7 (integración)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const cobro: jest.Mocked<RegistradorCobro> = {
    viajeCompletado: jest.fn().mockResolvedValue(undefined),
    cargoCancelacion: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    ({ app } = await crearApp({ registradorCobro: cobro }));
    http = request(app.getHttpServer());
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(() => app.close());

  async function crearViaje() {
    const ids = nuevosIds();
    const res = await http.post('/trips').set('Authorization', M5).send(cuerpoCrearViaje(ids)).expect(201);
    return { id: res.body.id as string, cliente: bearer('CLIENT', ids.clientId), conductor: bearer('DRIVER', ids.driverId) };
  }

  it('al completar el viaje avisa a M7 una vez, con el viaje ya completado', async () => {
    const v = await crearViaje();
    await http.post(`/trips/${v.id}/arrived`).set('Authorization', v.conductor).expect(200);
    await http.post(`/trips/${v.id}/start`).set('Authorization', v.conductor).send({ verificationToken: `QR-${v.id}` }).expect(200);
    await http.post(`/trips/${v.id}/complete`).set('Authorization', v.conductor).send({ distanceKm: 4.2 }).expect(200);

    expect(cobro.viajeCompletado).toHaveBeenCalledTimes(1);
    const [viaje] = cobro.viajeCompletado.mock.calls[0];
    expect(viaje.toProps()).toMatchObject({ id: v.id, state: 'COMPLETED', closure: { distanceKm: 4.2 } });
    expect(cobro.cargoCancelacion).not.toHaveBeenCalled();
  });

  it('si el cliente cancela con el conductor ya en el lugar, pide el cargo', async () => {
    const v = await crearViaje();
    await http.post(`/trips/${v.id}/arrived`).set('Authorization', v.conductor).expect(200);
    await http.post(`/trips/${v.id}/cancel`).set('Authorization', v.cliente).send({ reason: 'CHANGE_OF_PLANS' }).expect(200);

    expect(cobro.cargoCancelacion).toHaveBeenCalledTimes(1);
    expect(cobro.cargoCancelacion.mock.calls[0][0].toProps().id).toBe(v.id);
  });

  it('si el cliente cancela antes del arribo, no hay cargo', async () => {
    const v = await crearViaje();
    await http.post(`/trips/${v.id}/cancel`).set('Authorization', v.cliente).send({ reason: 'CHANGE_OF_PLANS' }).expect(200);
    expect(cobro.cargoCancelacion).not.toHaveBeenCalled();
  });

  it('si el conductor cancela por otro motivo, no hay cargo', async () => {
    const v = await crearViaje();
    await http.post(`/trips/${v.id}/cancel`).set('Authorization', v.conductor).send({ reason: 'VEHICLE_PROBLEM' }).expect(200);
    expect(cobro.cargoCancelacion).not.toHaveBeenCalled();
  });
});
