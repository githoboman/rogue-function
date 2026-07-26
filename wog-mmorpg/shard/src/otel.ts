/**
 * otel.ts — OpenTelemetry bootstrap for the WoG shard.
 *
 * MUST be imported FIRST (before Fastify/http/mqtt) so auto-instrumentation
 * can patch those libraries. Wire it up as the very first import in server.ts:
 *
 *     import "./otel";   // <- line 1, before anything else
 *
 * Sends traces + metrics + logs to SigNoz over OTLP/HTTP.
 * Config comes from env (see .env.example):
 *   OTEL_EXPORTER_OTLP_ENDPOINT   e.g. https://ingest.us2.signoz.cloud:443
 *   SIGNOZ_INGESTION_KEY          SigNoz Cloud ingestion key
 *   OTEL_SERVICE_NAME             defaults to "wog-shard"
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";

// Flip on with OTEL_DEBUG=1 to see exporter activity in the console.
if (process.env.OTEL_DEBUG === "1") {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
}

const endpoint =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "https://ingest.us2.signoz.cloud:443";
const ingestionKey = process.env.SIGNOZ_INGESTION_KEY || "";
const serviceName = process.env.OTEL_SERVICE_NAME || "wog-shard";

// SigNoz authenticates OTLP ingestion with the "signoz-ingestion-key" header.
const headers: Record<string, string> = ingestionKey
  ? { "signoz-ingestion-key": ingestionKey }
  : {};

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: serviceName,
  [ATTR_SERVICE_VERSION]: "1.0.0",
});

const sdk = new NodeSDK({
  resource,
  traceExporter: new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
    headers,
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${endpoint}/v1/metrics`,
      headers,
    }),
    exportIntervalMillis: 15000,
  }),
  logRecordProcessors: [
    new BatchLogRecordProcessor({
      exporter: new OTLPLogExporter({
        url: `${endpoint}/v1/logs`,
        headers,
      }),
    }),
  ],
  instrumentations: [
    getNodeAutoInstrumentations({
      // Fastify + http give us APM (p99, error rate, ops/sec) for free.
      // Disable fs instrumentation — too noisy, drowns the interesting spans.
      "@opentelemetry/instrumentation-fs": { enabled: false },
    }),
  ],
});

if (!ingestionKey) {
  // eslint-disable-next-line no-console
  console.warn(
    "[otel] SIGNOZ_INGESTION_KEY not set — telemetry will not reach SigNoz. " +
      "Set it in shard/.env (see .env.example).",
  );
}

sdk.start();
// eslint-disable-next-line no-console
console.log(`[otel] OpenTelemetry started → ${endpoint} (service=${serviceName})`);

process.on("SIGTERM", () => {
  sdk
    .shutdown()
    .catch((err) => console.error("[otel] shutdown error", err))
    .finally(() => process.exit(0));
});
