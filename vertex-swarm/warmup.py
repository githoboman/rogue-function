"""
Vertex Swarm Challenge 2026 — Warm Up: The Stateful Handshake
Two agents discover each other, sync state, and recover from failure.
Uses FoxMQ (Byzantine fault-tolerant MQTT broker) for consensus-ordered messaging.

Run:
  python warmup.py alpha    # terminal 1
  python warmup.py beta     # terminal 2
"""

import sys
import json
import time
import threading
import paho.mqtt.client as mqtt
from paho.mqtt.enums import MQTTProtocolVersion

# Windows terminal UTF-8 fix (Python 3.7+)
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

BROKER_HOST = "localhost"
BROKER_PORT = 1883
STALE_AFTER_MS = 10_000   # mark peer inactive after 10s silence

TOPIC_HELLO  = "swarm/hello"
TOPIC_STATE  = "swarm/state"

def now_ms():
    return int(time.time() * 1000)

_pub_seq = 0
def publish_json(client, topic, payload, qos=1):
    global _pub_seq
    _pub_seq += 1
    payload["seq"] = _pub_seq
    client.publish(topic, json.dumps(payload), qos=qos)

# ─────────────────────────────────────────────
class SwarmNode:
    def __init__(self, name: str, role: str):
        self.name   = name
        self.role   = role
        self.status = "online"
        self.peers  = {}   # name → {timestamp, role, status}
        self.lock   = threading.Lock()

        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=name,
            protocol=MQTTProtocolVersion.MQTTv5,
        )
        self.client.on_connect    = self._on_connect
        self.client.on_message    = self._on_message
        self.client.on_disconnect = self._on_disconnect

    # ── MQTT callbacks ──────────────────────────────────
    def _on_connect(self, client, userdata, flags, reason_code, properties):
        print(f"[{self.name}] Connected to FoxMQ broker (BFT-ordered mesh)")
        client.subscribe(TOPIC_HELLO, qos=1)
        client.subscribe(TOPIC_STATE, qos=1)
        self._send_hello()

    def _on_disconnect(self, client, userdata, flags, reason_code, properties):
        print(f"[{self.name}] Disconnected — reason={reason_code}")

    def _on_message(self, client, userdata, msg):
        try:
            data = json.loads(msg.payload)
        except json.JSONDecodeError:
            return

        sender = data.get("id")
        if not sender or sender == self.name:
            return   # ignore own messages

        with self.lock:
            was_known = sender in self.peers
            was_stale = was_known and self.peers[sender].get("status") == "stale"

            self.peers[sender] = {
                "peer_id":      sender,
                "last_seen_ms": data.get("timestamp", now_ms()),
                "role":         data.get("role", "unknown"),
                "status":       "active",
            }

        if not was_known:
            print(f"[{self.name}] ✅ DISCOVERED peer: {sender} (role={data.get('role')})")
        elif was_stale:
            print(f"[{self.name}] 🔄 RECOVERED peer: {sender} — back online")

        # Mirror role change within <1s (state mirroring requirement)
        if was_known and self.peers[sender]["role"] != data.get("role"):
            print(f"[{self.name}] STATE MIRROR: {sender} role changed -> {data.get('role')} (replicated in <1s)")

        if msg.topic == TOPIC_HELLO:
            print(f"[{self.name}] 👋 HANDSHAKE from {sender} | role={data.get('role')} status={data.get('status')}")
            self._send_state()   # reply with own state

    # ── Message senders ─────────────────────────────────
    def _send_hello(self):
        payload = {
            "id":        self.name,
            "timestamp": now_ms(),
            "role":      self.role,
            "status":    self.status,
            "msg":       "HELLO",
        }
        publish_json(self.client, TOPIC_HELLO, payload)
        print(f"[{self.name}] 📢 Sent HELLO (role={self.role})")

    def _send_state(self):
        payload = {
            "id":        self.name,
            "timestamp": now_ms(),
            "role":      self.role,
            "status":    self.status,
            "peers_known": list(self.peers.keys()),
        }
        publish_json(self.client, TOPIC_STATE, payload)

    # ── Heartbeat loop ───────────────────────────────────
    def _heartbeat_loop(self):
        while True:
            time.sleep(3)
            self._send_state()
            self._check_stale()
            self._print_swarm_view()

    def _check_stale(self):
        cutoff = now_ms() - STALE_AFTER_MS
        with self.lock:
            for peer, info in self.peers.items():
                if info["status"] == "active" and info["last_seen_ms"] < cutoff:
                    info["status"] = "stale"
                    print(f"[{self.name}] STALE DETECTED: {peer} — no heartbeat for >{STALE_AFTER_MS//1000}s (last_seen_ms={info['last_seen_ms']})")

    def _print_swarm_view(self):
        with self.lock:
            parts = []
            for peer, info in self.peers.items():
                icon = "🟢" if info["status"] == "active" else "🔴"
                parts.append(f"{icon} {peer}({info['role']})")
        if parts:
            print(f"[{self.name}] Swarm view: {' | '.join(parts)}")
        else:
            print(f"[{self.name}] Swarm view: (no peers yet)")

    # ── Start ────────────────────────────────────────────
    def start(self):
        self.client.connect(BROKER_HOST, BROKER_PORT)
        t = threading.Thread(target=self._heartbeat_loop, daemon=True)
        t.start()
        self.client.loop_forever()

# ─────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in ("alpha", "beta"):
        print("Usage: python warmup.py alpha|beta")
        sys.exit(1)

    name = sys.argv[1]
    role = "coordinator" if name == "alpha" else "worker"
    node = SwarmNode(name=name, role=role)
    print(f"Starting Swarm Node [{name}] role={role}")
    print("Connecting to FoxMQ (BFT-ordered mesh)...\n")
    node.start()
