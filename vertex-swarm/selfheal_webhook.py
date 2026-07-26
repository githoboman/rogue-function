"""
selfheal_webhook.py — SigNoz-driven self-healing for the WoG swarm.

This is the "Self-healing infra with SigNoz metrics" Track 1 build. Instead of
the agents detecting a dead peer purely peer-to-peer, SigNoz becomes the
detector: an Alert on a missing-heartbeat / HP-anomaly metric fires and POSTs
here. We turn that alert into a mesh command that redistributes the dead
agent's zones and quests — and we do it inside an OTel trace, so the recovery
shows up in SigNoz linked to the alert that caused it.

Flow:
  agent goes silent
    → wog.agent.hp / heartbeat metric gap crosses threshold in SigNoz
    → SigNoz Alert fires → webhook POST to this server
    → we publish wog/heal/redistribute {dead_agent} to FoxMQ
    → healthy agents free the dead agent's claims (see _handle_redistribute)
    → recovery trace visible in SigNoz

Run:
  python selfheal_webhook.py          # listens on :8099
Point a SigNoz Alert notification channel (webhook) at:
  http://<host>:8099/signoz-alert
"""

import os
import json
import http.server
import socketserver

import paho.mqtt.client as mqtt
from paho.mqtt.enums import MQTTProtocolVersion
from paho.mqtt.properties import Properties
from paho.mqtt.packettypes import PacketTypes

import otel_swarm as otel

BROKER_HOST = os.environ.get("FOXMQ_HOST", "localhost")
BROKER_PORT = int(os.environ.get("FOXMQ_PORT", "1883"))
LISTEN_PORT = int(os.environ.get("SELFHEAL_PORT", "8099"))

otel.init_otel("selfheal-controller")
_tracer = otel.get_tracer()

_mqtt = mqtt.Client(
    mqtt.CallbackAPIVersion.VERSION2,
    client_id="wog-selfheal",
    protocol=MQTTProtocolVersion.MQTTv5,
)


def _publish_redistribute(dead_agent: str, reason: str, alert_name: str):
    """Publish a redistribute command, propagating trace context to the mesh."""
    with _tracer.start_as_current_span(
        "selfheal.redistribute",
        kind=otel.span_kind_producer(),
    ) as span:
        span.set_attribute("wog.dead_agent", dead_agent)
        span.set_attribute("wog.heal.reason", reason)
        span.set_attribute("signoz.alert", alert_name)
        span.set_attribute("messaging.system", "foxmq")
        span.set_attribute("messaging.destination.name", "wog/heal/redistribute")

        payload = {
            "agent": "selfheal",
            "dead_agent": dead_agent,
            "reason": reason,
            "alert": alert_name,
        }
        carrier: dict = {}
        otel.inject_context(carrier)
        props = Properties(PacketTypes.PUBLISH)
        if carrier:
            props.UserProperty = [(k, v) for k, v in carrier.items()]
        _mqtt.publish("wog/heal/redistribute", json.dumps(payload), qos=1, properties=props)
        print(f"[selfheal] SigNoz alert '{alert_name}' → redistribute {dead_agent} ({reason})")


def _extract_dead_agent(alert: dict) -> str:
    """Best-effort pull of the offending agent from a SigNoz alert payload.

    SigNoz alert webhooks include the label set that tripped the rule; our
    metrics are labelled with `agent`, so it usually lands in labels/agent.
    """
    # SigNoz Alertmanager-style payload: {"alerts":[{"labels":{...}}]}
    for a in alert.get("alerts", []):
        labels = a.get("labels", {})
        if "agent" in labels:
            return labels["agent"]
    # Flat fallbacks
    return (
        alert.get("labels", {}).get("agent")
        or alert.get("agent")
        or "unknown"
    )


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path.rstrip("/") != "/signoz-alert":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            alert = json.loads(raw or b"{}")
        except Exception:
            alert = {}

        with _tracer.start_as_current_span("selfheal.alert_received") as span:
            alert_name = (
                alert.get("commonLabels", {}).get("alertname")
                or alert.get("alertname")
                or "wog-agent-down"
            )
            dead_agent = _extract_dead_agent(alert)
            status = alert.get("status", "firing")
            span.set_attribute("signoz.alert", alert_name)
            span.set_attribute("signoz.alert.status", status)
            span.set_attribute("wog.dead_agent", dead_agent)

            if status == "firing":
                _publish_redistribute(dead_agent, f"signoz:{alert_name}", alert_name)

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def do_GET(self):
        # Health check
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"service":"wog-selfheal","ok":true}')

    def log_message(self, *_a):
        pass  # quiet default logging


def main():
    _mqtt.connect(BROKER_HOST, BROKER_PORT)
    _mqtt.loop_start()
    print(f"[selfheal] listening on :{LISTEN_PORT}/signoz-alert → FoxMQ {BROKER_HOST}:{BROKER_PORT}")
    with socketserver.TCPServer(("0.0.0.0", LISTEN_PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[selfheal] stopped")


if __name__ == "__main__":
    main()
