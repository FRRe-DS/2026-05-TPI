/**
 * Arranque de OpenTelemetry. Tiene que importarse ANTES que cualquier otro módulo (primera línea
 * de main.ts): las instrumentaciones "enganchan" http, pg, ioredis, etc. al cargarse, y si esos
 * módulos ya se cargaron, no se pueden enganchar.
 *
 * Sólo se activa si hay un destino configurado (OTEL_EXPORTER_OTLP_ENDPOINT). Sin esa variable no
 * hace nada, así los tests y el desarrollo sin observabilidad quedan igual que antes.
 *
 * Toda la configuración (destino, nombre del servicio, atributos) viene de variables de entorno
 * estándar de OpenTelemetry (RNF-06): ver .env.example.
 */
// NestJS lee el .env más tarde, cuando este archivo ya se ejecutó. Se carga acá primero para que las
// variables OTEL_* del .env valgan también para el SDK (no pisa las que ya vengan del entorno).
try {
  process.loadEnvFile();
} catch {
  // Sin .env (por ejemplo en Docker, donde las variables llegan por el entorno): no pasa nada.
}

import { HostMetrics } from '@opentelemetry/host-metrics';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { AmqplibInstrumentation } from '@opentelemetry/instrumentation-amqplib';
import { ExpressInstrumentation, ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT && process.env.OTEL_SDK_DISABLED !== 'true') {
  const sdk = new NodeSDK({
    // Los exportadores leen el destino de OTEL_EXPORTER_OTLP_ENDPOINT (agregan /v1/traces, etc.).
    traceExporter: new OTLPTraceExporter(),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? 5000),
      }),
    ],
    logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
    instrumentations: [
      // Pedidos HTTP entrantes. Los health checks (cada pocos segundos) se ignoran para no llenar de ruido.
      new HttpInstrumentation({ ignoreIncomingRequestHook: (pedido) => pedido.url?.startsWith('/health') ?? false }),
      // Sin un span por cada middleware de Express (hay ~6 por pedido y no aportan).
      new ExpressInstrumentation({ ignoreLayersType: [ExpressLayerType.MIDDLEWARE] }),
      new NestInstrumentation(),
      // Sólo consultas que nacen de un pedido: el relevador de eventos consulta la base cada segundo
      // por su cuenta y llenaría Jaeger de trazas sueltas.
      new PgInstrumentation({ requireParentSpan: true }),
      new IORedisInstrumentation(),
      new AmqplibInstrumentation(),
      // fetch() de Node usa undici: es lo que usa la llamada a M8 para validar el QR.
      new UndiciInstrumentation(),
      // Métricas del runtime: event loop, GC, heap.
      new RuntimeNodeInstrumentation(),
    ],
  });
  sdk.start();

  // CPU y memoria del proceso (indicadores técnicos del dashboard).
  new HostMetrics({ name: 'm6-viajes' }).start();

  // Al apagar el servicio, envía lo que quede en los buffers.
  for (const senal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(senal, () => void sdk.shutdown());
  }
}
