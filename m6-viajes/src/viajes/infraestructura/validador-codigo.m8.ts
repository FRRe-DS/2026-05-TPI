import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { DependenciaNoDisponibleError } from '../aplicacion/errores';
import { ResultadoValidacionCodigo, ValidadorCodigoVerificacion } from '../aplicacion/puertos';

/**
 * Valida el QR de inicio de viaje (RF-6.4) contra las implementaciones de M8 (RF-8.3).
 *
 * En la plataforma conviven dos M8: el del Grupo 7 y el del Grupo 10. El QR lo genera uno de los
 * dos (el que use la app del cliente) y M6 no sabe cuál, así que se le pregunta a todos en paralelo.
 * Cada token existe en un solo M8, por lo que a lo sumo uno lo reconoce y lo consume.
 *
 * Los dos grupos comparten un contrato coordinado (ver docs/acuerdos-con-otros-grupos.md, sección M8):
 *   POST /api/v1/qr/validaciones  { token, viajeId }  →  200 | 404 no existe | 409 usado | 422 vencido u otro viaje
 * La ruta se puede cambiar por proveedor (M8_G7_RUTA_QR, M8_G10_RUTA_QR) mientras algún grupo no la
 * tenga implementada donde dice el contrato.
 *
 * Cómo se combinan las respuestas:
 *  - Si alguno lo acepta → VALIDO.
 *  - Si alguno lo conoce y lo rechaza (usado, vencido, de otro viaje) → INVALIDO.
 *  - Si alguno no respondió y ninguno lo reconoció → 503, porque el QR podría ser del que está caído.
 *  - Si todos responden que no existe → INVALIDO.
 *
 * Nunca se espera indefinidamente: cada llamada tiene timeout (RNF-13).
 */

export type VarianteM8 = 'g7' | 'g10';

export interface ConfiguracionProveedorM8 {
  variante: VarianteM8;
  urlBase: string;
  /** Ruta de validación. Si no se indica, se usa la del contrato publicado por el grupo. */
  ruta?: string;
  /** JWT de servicio emitido por M1 para llamar a este M8. */
  tokenServicio?: string;
}

/** Resultado de preguntarle a un solo M8. */
export type RespuestaProveedor = 'VALIDO' | 'INVALIDO' | 'DESCONOCIDO' | 'NO_DISPONIBLE';

/** Ruta del contrato coordinado entre los grupos 7 y 10. */
export const RUTA_POR_DEFECTO = '/api/v1/qr/validaciones';

const NOMBRES: Record<VarianteM8, string> = { g7: 'M8 (Grupo 7)', g10: 'M8 (Grupo 10)' };

export class ProveedorQrM8 {
  private readonly logger = new Logger(ProveedorQrM8.name);
  readonly nombre: string;
  private readonly url: string;

  constructor(
    private readonly config: ConfiguracionProveedorM8,
    private readonly timeoutMs: number,
  ) {
    this.nombre = NOMBRES[config.variante];
    this.url = config.urlBase.replace(/\/+$/, '') + (config.ruta ?? RUTA_POR_DEFECTO);
  }

  async validar(tripId: string, code: string, correlationId: string): Promise<RespuestaProveedor> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId,
      'X-Request-Id': correlationId,
      // Misma clave para el mismo QR y viaje: si se reintenta tras un timeout, el M8 devuelve la
      // respuesta original en lugar de un 409 por "ya usado".
      'Idempotency-Key': claveIdempotencia(tripId, code),
    };
    if (this.config.tokenServicio) {
      headers.Authorization = `Bearer ${this.config.tokenServicio}`;
    }
    const cuerpo = { token: code, viajeId: tripId };

    let respuesta: Response;
    try {
      respuesta = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      this.logger.warn(`${this.nombre} no respondió al validar el QR del viaje ${tripId}: ${String(error)}`);
      return 'NO_DISPONIBLE';
    }

    if (respuesta.status >= 500) {
      this.logger.warn(`${this.nombre} respondió ${respuesta.status} al validar el QR del viaje ${tripId}`);
      return 'NO_DISPONIBLE';
    }
    if (respuesta.status === 401 || respuesta.status === 403) {
      // No es un QR inválido: es un problema de credenciales entre módulos. No culpar al conductor.
      this.logger.error(`${this.nombre} rechazó la autenticación de M6 (${respuesta.status}); revisar el token de servicio`);
      return 'NO_DISPONIBLE';
    }
    if (respuesta.status === 404) {
      return 'DESCONOCIDO';
    }
    if (!respuesta.ok) {
      // 400, 409, 410, 422: el M8 conoce el QR y lo rechaza (otro viaje, ya usado, vencido).
      return 'INVALIDO';
    }

    const datos = (await respuesta.json().catch(() => ({}))) as Record<string, unknown>;
    if (datos.valido === false || datos.valid === false) {
      return 'INVALIDO';
    }
    // Control propio: el QR tiene que ser de este viaje, aunque el M8 no lo verifique.
    const viajeDelQr = datos.viajeId ?? datos.tripId;
    if (typeof viajeDelQr === 'string' && viajeDelQr.toLowerCase() !== tripId.toLowerCase()) {
      this.logger.warn(`${this.nombre} aceptó un QR del viaje ${viajeDelQr} para el viaje ${tripId}; se rechaza`);
      return 'INVALIDO';
    }
    return 'VALIDO';
  }
}

export class ValidadorCodigoM8 implements ValidadorCodigoVerificacion {
  constructor(private readonly proveedores: ProveedorQrM8[]) {
    if (proveedores.length === 0) {
      throw new Error('ValidadorCodigoM8 necesita al menos un M8 configurado');
    }
  }

  async validarYConsumir(tripId: string, code: string, correlationId: string): Promise<ResultadoValidacionCodigo> {
    const respuestas = await Promise.all(this.proveedores.map((p) => p.validar(tripId, code, correlationId)));

    if (respuestas.includes('VALIDO')) return 'VALIDO';
    if (respuestas.includes('INVALIDO')) return 'INVALIDO';
    if (respuestas.includes('NO_DISPONIBLE')) {
      const caidos = this.proveedores.filter((_, i) => respuestas[i] === 'NO_DISPONIBLE').map((p) => p.nombre);
      throw new DependenciaNoDisponibleError(caidos.join(', '));
    }
    return 'INVALIDO';
  }
}

function claveIdempotencia(tripId: string, code: string): string {
  return 'm6-qr-' + createHash('sha256').update(`${tripId}:${code}`).digest('hex').slice(0, 32);
}

/** Arma los proveedores a partir de las variables de entorno (ver .env.example). */
export function proveedoresDesdeEntorno(get: (nombre: string) => string | undefined, timeoutMs: number): ProveedorQrM8[] {
  return variantesConfiguradas(get('M8_PROVEEDORES')).map((variante) => {
    const prefijo = `M8_${variante.toUpperCase()}`;
    return new ProveedorQrM8(
      {
        variante,
        urlBase: get(`${prefijo}_URL`) ?? '',
        ruta: get(`${prefijo}_RUTA_QR`) || undefined,
        tokenServicio: get(`${prefijo}_TOKEN`) || undefined,
      },
      timeoutMs,
    );
  });
}

export function variantesConfiguradas(valor: string | undefined): VarianteM8[] {
  return (valor ?? 'g7,g10')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0) as VarianteM8[];
}
