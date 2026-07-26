"""
otel_swarm.py — OpenTelemetry wiring for the WoG agent swarm → SigNoz.

Keeps all telemetry concerns out of wog_swarm.py. Provides:
  - init_otel(agent_name)      one-time SDK setup (traces + metrics + logs)
  - tracer / meter handles     for spans and metrics
  - inject_context(props)      put W3C traceparent into MQTT5 user properties
  - extract_context(props)     pull it back out on the receiving side
  - agent metric instruments   HP / gold / consensus wins / conflicts

Config (env, see .env.example):
  OTEL_EXPORTER_OTLP_ENDPOINT   https://ingest.us2.signoz.cloud:443
  SIGNOZ_INGESTION_KEY          SigNoz Cloud ingestion key
  OTEL_SERVICE_NAME             defaults to "wog-agent-swarm"

Install:
  pip install -r requirements.txt   (opentelemetry-* pinned there)

If the OTel libs or the ingestion key are missing, everything degrades to
no-ops so the swarm still runs offline (matches the "works offline" design).
"""

import os

# ── Graceful degradation: if OTel isn't installed, expose no-op shims ────────
try:
    from opentelemetry import trace, metrics, _logs as logs
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
    from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
    from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
    from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
    from opentelemetry.propagate import inject as _otel_inject, extract as _otel_extract
    from opentelemetry.trace import SpanKind
    _OTEL_AVAILABLE = True
except Exception:  # pragma: no cover — offline / libs missing
    _OTEL_AVAILABLE = False


_ENDPOINT = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "https://ingest.us2.signoz.cloud:443")
_KEY = os.environ.get("SIGNOZ_INGESTION_KEY", "")
_HEADERS = {"signoz-ingestion-key": _KEY} if _KEY else {}

_tracer = None
_meter = None
_enabled = False

# metric instruments (populated by init_otel)
m_hp = None
m_gold = None
m_consensus_wins = None
m_consensus_conflicts = None
m_messages_published = None


class _NoopSpan:
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False
    def set_attribute(self, *a, **k):
        pass
    def add_event(self, *a, **k):
        pass
    def record_exception(self, *a, **k):
        pass


class _NoopTracer:
    def start_as_current_span(self, *a, **k):
        return _NoopSpan()


class _NoopInstrument:
    def add(self, *a, **k):
        pass
    def record(self, *a, **k):
        pass
    def set(self, *a, **k):
        pass


def init_otel(agent_name: str):
    """One-time init. Safe to call per-process; returns (tracer, enabled)."""
    global _tracer, _meter, _enabled
    global m_hp, m_gold, m_consensus_wins, m_consensus_conflicts, m_messages_published

    if not _OTEL_AVAILABLE or not _KEY:
        _tracer = _NoopTracer()
        for name in ("m_hp", "m_gold", "m_consensus_wins",
                     "m_consensus_conflicts", "m_messages_published"):
            globals()[name] = _NoopInstrument()
        reason = "otel libs not installed" if not _OTEL_AVAILABLE else "SIGNOZ_INGESTION_KEY not set"
        print(f"[otel] disabled ({reason}) — swarm runs without telemetry")
        return _tracer, False

    service = os.environ.get("OTEL_SERVICE_NAME", "wog-agent-swarm")
    resource = Resource.create({
        "service.name": service,
        "service.namespace": "world-of-guilds",
        "deployment.environment": "hackathon",
        "wog.agent": agent_name,
    })

    # ── Traces ──────────────────────────────────────────────
    tp = TracerProvider(resource=resource)
    tp.add_span_processor(BatchSpanProcessor(
        OTLPSpanExporter(endpoint=f"{_ENDPOINT}/v1/traces", headers=_HEADERS)))
    trace.set_tracer_provider(tp)
    _tracer = trace.get_tracer("wog.swarm")

    # ── Metrics ─────────────────────────────────────────────
    reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=f"{_ENDPOINT}/v1/metrics", headers=_HEADERS),
        export_interval_millis=15000)
    mp = MeterProvider(resource=resource, metric_readers=[reader])
    metrics.set_meter_provider(mp)
    _meter = metrics.get_meter("wog.swarm")

    m_hp = _meter.create_gauge("wog.agent.hp", description="Agent current HP")
    m_gold = _meter.create_gauge("wog.agent.gold", description="Agent current gold")
    m_consensus_wins = _meter.create_counter(
        "wog.consensus.wins", description="Zone/quest/property claims won via FoxMQ order")
    m_consensus_conflicts = _meter.create_counter(
        "wog.consensus.conflicts", description="Claims lost to an earlier consensus-ordered peer")
    m_messages_published = _meter.create_counter(
        "wog.mesh.messages_published", description="Messages published to FoxMQ, by topic")

    # ── Logs ────────────────────────────────────────────────
    lp = LoggerProvider(resource=resource)
    lp.add_log_record_processor(BatchLogRecordProcessor(
        OTLPLogExporter(endpoint=f"{_ENDPOINT}/v1/logs", headers=_HEADERS)))
    logs.set_logger_provider(lp)

    _enabled = True
    print(f"[otel] enabled -> {_ENDPOINT} (service={service}, agent={agent_name})")
    return _tracer, True


def get_tracer():
    return _tracer if _tracer is not None else _NoopTracer()


def span_kind_producer():
    return SpanKind.PRODUCER if _OTEL_AVAILABLE else None


def span_kind_consumer():
    return SpanKind.CONSUMER if _OTEL_AVAILABLE else None


def inject_context(carrier: dict) -> dict:
    """Inject W3C traceparent (+baggage) into a dict carrier (MQTT user props)."""
    if _enabled:
        _otel_inject(carrier)
    return carrier


def extract_context(carrier: dict):
    """Extract a context from a carrier dict. Returns None if disabled."""
    if _enabled and carrier:
        return _otel_extract(carrier)
    return None


def get_logging_handler():
    """OTel logging handler to attach to Python's logging, if enabled."""
    if _enabled and _OTEL_AVAILABLE:
        return LoggingHandler(logger_provider=logs.get_logger_provider())
    return None


# ── Structured logging → SigNoz Logs ─────────────────────────────────────────
# Route through Python's stdlib logging with the OTel LoggingHandler attached.
# Log records carry `extra` attributes (searchable in SigNoz) and are
# auto-correlated to the active trace/span by the handler. No-op if disabled.
import logging as _logging

_std_logger = None


def _ensure_logger():
    global _std_logger
    if _std_logger is not None:
        return _std_logger
    lg = _logging.getLogger("wog.swarm")
    lg.setLevel(_logging.INFO)
    lg.propagate = False
    handler = get_logging_handler()
    if handler is not None:
        lg.addHandler(handler)
    _std_logger = lg
    return lg


def emit_log(body: str, attributes: dict = None, severity: str = "info"):
    """
    Emit a structured log record to SigNoz. No-op if OTel is disabled.
    `severity` is "info" | "warn" | "error". Attributes land as searchable
    fields via the stdlib `extra=` mechanism.
    """
    if not (_enabled and _OTEL_AVAILABLE):
        return
    try:
        lg = _ensure_logger()
        level = {"info": _logging.INFO, "warn": _logging.WARNING,
                 "error": _logging.ERROR}.get(severity, _logging.INFO)
        lg.log(level, body, extra={"wog": attributes or {}})
    except Exception:
        pass  # Never let logging break the swarm.
