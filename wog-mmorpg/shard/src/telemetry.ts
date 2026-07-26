/**
 * telemetry.ts — app-level OpenTelemetry helpers for the shard.
 *
 * otel.ts does the SDK bootstrap (must import first). This module provides the
 * handles the game code uses: a tracer, custom metric instruments, a structured
 * logger, and MQTT context propagation helpers (extract/inject W3C traceparent
 * to/from MQTT 5.0 user properties) so the trace started by a Python agent
 * continues through the shard and into the Stacks blockchain calls.
 */

import {
  trace,
  metrics,
  context as otelContext,
  propagation,
  SpanKind,
  SpanStatusCode,
  type Span,
  type Context,
} from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

export const tracer = trace.getTracer("wog.shard");
const meter = metrics.getMeter("wog.shard");
const otelLogger = logs.getLogger("wog.shard");

// ── Custom metrics (join the Python swarm's metrics in SigNoz dashboards) ────
export const meshMessagesReceived = meter.createCounter("wog.mesh.messages_received", {
  description: "FoxMQ messages consumed by the shard, by topic",
});
export const blockchainTxCounter = meter.createCounter("wog.blockchain.tx", {
  description: "Stacks transactions attempted by the shard, by kind/result",
});
export const blockchainTxLatency = meter.createHistogram("wog.blockchain.tx_latency_ms", {
  description: "Latency of Stacks transactions in milliseconds",
  unit: "ms",
});
export const propertyTransferCounter = meter.createCounter("wog.property.transfers", {
  description: "Property deed transfers settled via consensus order",
});

/**
 * Extract a W3C trace context from an MQTT 5.0 packet's user properties.
 * Returns the active context if none present (span becomes a new root).
 */
export function contextFromMqtt(userProperties?: Record<string, string | string[]>): Context {
  if (!userProperties) return otelContext.active();
  const carrier: Record<string, string> = {};
  for (const [k, v] of Object.entries(userProperties)) {
    carrier[k] = Array.isArray(v) ? v[0] : v;
  }
  return propagation.extract(otelContext.active(), carrier);
}

/** Inject the active trace context into an MQTT 5.0 userProperties object. */
export function mqttPropsFromContext(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(otelContext.active(), carrier);
  return carrier;
}

/**
 * Run `fn` inside a span, recording errors and setting status. Async-aware.
 */
export async function withSpan<T>(
  name: string,
  attrs: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T> | T,
  kind: SpanKind = SpanKind.INTERNAL,
): Promise<T> {
  return tracer.startActiveSpan(name, { kind, attributes: attrs }, async (span) => {
    try {
      const out = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return out;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Structured log → SigNoz Logs, correlated to the active trace. */
export function emitLog(
  body: string,
  attributes: Record<string, string | number | boolean> = {},
  severity: "info" | "warn" | "error" = "info",
) {
  const severityNumber =
    severity === "error"
      ? SeverityNumber.ERROR
      : severity === "warn"
        ? SeverityNumber.WARN
        : SeverityNumber.INFO;
  otelLogger.emit({
    severityNumber,
    severityText: severity.toUpperCase(),
    body,
    attributes,
  });
}

export { SpanKind, SpanStatusCode };
