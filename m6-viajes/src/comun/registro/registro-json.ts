import { LoggerService, LogLevel } from '@nestjs/common';
import { logs, SeverityNumber, trace } from '@opentelemetry/api';
import { contextoPedido } from './contexto-pedido';

/**
 * Logger que escribe una línea JSON por evento (logs estructurados, RNF-14), por ejemplo:
 *   {"momento":"2026-10-08T15:00:00.000Z","nivel":"info","contexto":"Pedidos","mensaje":"POST /trips 201",
 *    "idCorrelacion":"...","viajeId":"..."}
 * Las herramientas de logs (Grafana Loki, CloudWatch, etc.) pueden filtrar por cualquier campo.
 *
 * Nunca se escriben tokens, cuerpos de pedidos ni coordenadas (RNF-19).
 */
const SEVERIDAD: Record<string, SeverityNumber> = {
  verbose: SeverityNumber.TRACE,
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
  fatal: SeverityNumber.FATAL,
};

export class RegistroJson implements LoggerService {
  constructor(private readonly escribir: (linea: string) => void = (linea) => process.stdout.write(linea + '\n')) {}

  log(message: unknown, ...resto: unknown[]): void {
    this.emitir('info', message, resto);
  }

  warn(message: unknown, ...resto: unknown[]): void {
    this.emitir('warn', message, resto);
  }

  error(message: unknown, ...resto: unknown[]): void {
    // Nest llama a error(mensaje, stack, contexto).
    const [stack, ...demas] = resto;
    const conStack = typeof stack === 'string' && stack.includes('\n') ? { stack } : undefined;
    this.emitir('error', message, conStack ? demas : resto, conStack);
  }

  debug(message: unknown, ...resto: unknown[]): void {
    this.emitir('debug', message, resto);
  }

  verbose(message: unknown, ...resto: unknown[]): void {
    this.emitir('verbose', message, resto);
  }

  fatal(message: unknown, ...resto: unknown[]): void {
    this.emitir('fatal', message, resto);
  }

  setLogLevels?(_niveles: LogLevel[]): void {}

  private emitir(nivel: string, message: unknown, resto: unknown[], extra?: Record<string, unknown>): void {
    // El último argumento de Nest es el contexto (nombre del Logger): "ViajesService", "RabbitMQ", etc.
    const contexto = typeof resto[resto.length - 1] === 'string' ? (resto[resto.length - 1] as string) : undefined;
    // Se puede loguear un texto o un objeto con campos: logger.log({ mensaje: '...', estado: 201 }).
    const esObjeto = typeof message === 'object' && message !== null && !(message instanceof Error);
    const { message: texto, ...campos } = esObjeto ? (message as Record<string, unknown>) : { message };
    // Si hay una traza activa, la línea lleva su id: en Grafana se salta del log a la traza y viceversa.
    const span = trace.getActiveSpan()?.spanContext();
    const linea = {
      momento: new Date().toISOString(),
      nivel,
      ...(contexto && { contexto }),
      message: String(texto ?? ''),
      ...contextoPedido.actual(),
      ...campos,
      ...extra,
      ...(span && { trace_id: span.traceId, span_id: span.spanId }),
    };
    this.escribir(JSON.stringify(linea));
    this.enviarAOpenTelemetry(nivel, linea);
  }

  /** Envía la línea también por OpenTelemetry (hacia Loki). Sin OpenTelemetry activo no hace nada. */
  private enviarAOpenTelemetry(nivel: string, linea: Record<string, unknown>): void {
    const { message, momento: _momento, nivel: _nivel, stack: _stack, ...resto } = linea;
    const atributos = Object.fromEntries(
      Object.entries(resto).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)),
    ) as Record<string, string | number | boolean>;
    logs.getLogger('m6-viajes').emit({
      severityNumber: SEVERIDAD[nivel] ?? SeverityNumber.INFO,
      severityText: nivel.toUpperCase(),
      body: String(message),
      attributes: { ...atributos, ...(typeof linea.stack === 'string' && { 'exception.stacktrace': linea.stack }) },
    });
  }
}
