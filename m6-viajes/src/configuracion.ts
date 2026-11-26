import { variantesConfiguradas } from './viajes/infraestructura/validador-codigo.m8';

/**
 * Valida las variables de entorno al arrancar (RNF-06: la configuración vive fuera del código).
 * Si falta algo, el servicio no arranca y el mensaje dice qué corregir.
 */
export function validarConfiguracion(env: Record<string, unknown>): Record<string, unknown> {
  const errores: string[] = [];

  const secreto = env.JWT_SECRETO;
  if (typeof secreto !== 'string' || secreto.length < 16) {
    errores.push('JWT_SECRETO es obligatorio y debe tener al menos 16 caracteres');
  }

  const validador = env.VALIDADOR_QR ?? 'simulado';
  if (validador !== 'simulado' && validador !== 'm8') {
    errores.push('VALIDADOR_QR debe ser "simulado" o "m8"');
  }
  if (validador === 'm8') {
    const variantes = variantesConfiguradas(env.M8_PROVEEDORES as string | undefined);
    if (variantes.length === 0) {
      errores.push('M8_PROVEEDORES debe listar al menos un M8 ("g7", "g10" o "g7,g10")');
    }
    for (const variante of variantes) {
      if (variante !== 'g7' && variante !== 'g10') {
        errores.push(`M8_PROVEEDORES tiene un valor desconocido: "${variante}" (usar "g7" y/o "g10")`);
      } else if (!env[`M8_${variante.toUpperCase()}_URL`]) {
        errores.push(`M8_${variante.toUpperCase()}_URL es obligatoria cuando M8_PROVEEDORES incluye "${variante}"`);
      }
    }
  }

  const registroTarifa = env.REGISTRO_TARIFA ?? 'ninguno';
  if (registroTarifa !== 'ninguno' && registroTarifa !== 'm7') {
    errores.push('REGISTRO_TARIFA debe ser "ninguno" o "m7"');
  }
  if (registroTarifa === 'm7' && !env.M7_URL) {
    errores.push('M7_URL es obligatoria cuando REGISTRO_TARIFA=m7');
  }

  const persistencia = env.PERSISTENCIA ?? 'memoria';
  if (persistencia !== 'memoria' && persistencia !== 'postgres') {
    errores.push('PERSISTENCIA debe ser "memoria" o "postgres"');
  }
  if (persistencia === 'postgres' && !env.BASE_DATOS_URL) {
    errores.push('BASE_DATOS_URL es obligatoria cuando PERSISTENCIA=postgres');
  }

  const publicador = env.PUBLICADOR_EVENTOS ?? 'log';
  if (publicador !== 'log' && publicador !== 'rabbitmq') {
    errores.push('PUBLICADOR_EVENTOS debe ser "log" o "rabbitmq"');
  }
  if (publicador === 'rabbitmq' && !env.RABBITMQ_URL) {
    errores.push('RABBITMQ_URL es obligatoria cuando PUBLICADOR_EVENTOS=rabbitmq');
  }

  const idempotencia = env.IDEMPOTENCIA ?? 'memoria';
  if (idempotencia !== 'memoria' && idempotencia !== 'redis') {
    errores.push('IDEMPOTENCIA debe ser "memoria" o "redis"');
  }
  if (idempotencia === 'redis' && !env.REDIS_URL) {
    errores.push('REDIS_URL es obligatoria cuando IDEMPOTENCIA=redis');
  }

  if (env.LOG_FORMATO !== undefined && env.LOG_FORMATO !== 'json' && env.LOG_FORMATO !== 'texto') {
    errores.push('LOG_FORMATO debe ser "json" o "texto"');
  }

  for (const nombre of ['LIMITE_PEDIDOS_POR_MINUTO', 'LIMITE_PEDIDOS_SERVICIO_POR_MINUTO', 'REDIS_TIMEOUT_MS', 'OUTBOX_INTERVALO_MS', 'OUTBOX_TAMANIO_LOTE', 'RABBITMQ_TIMEOUT_MS', 'PUERTO', 'ESPERA_MINIMA_ARRIBO_MINUTOS', 'M8_TIMEOUT_MS', 'M7_TIMEOUT_MS']) {
    if (env[nombre] !== undefined && !(Number(env[nombre]) >= 0)) {
      errores.push(`${nombre} debe ser un número`);
    }
  }

  if (errores.length > 0) {
    throw new Error(
      `Configuración inválida:\n - ${errores.join('\n - ')}\n` +
        'Copiá .env.example a .env y completá los valores.',
    );
  }
  return env;
}
