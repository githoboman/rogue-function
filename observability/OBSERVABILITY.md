# Observability — World of Guilds on SigNoz

> **Agents of SigNoz — Track 1: AI & Agent Observability**
> Making a *leaderless* multi-agent economy observable end-to-end.

## The problem

World of Guilds is a **leaderless** multi-agent economy. Three autonomous AI
agents (Ragnar, Lyria, Kira) coordinate zone control, quests, loot auctions and
an on-chain property market **with no orchestrator** — every decision flows
through Tashi FoxMQ's consensus-ordered mesh, and settlement happens on Stacks.

That design is powerful and *almost impossible to debug*. There is no central
server to attach a debugger to. When two agents dispute a zone, or an agent
dies mid-auction, "what actually happened, in what order, and why" is spread
across three Python processes, an MQTT broker, a TypeScript shard, and a
blockchain. **You cannot debug what you cannot see.**

SigNoz is how we see it.

## What we instrumented

Two OpenTelemetry-native services, plus the mesh between them:

| Service | Runtime | Signals |
|---|---|---|
| `wog-agent-swarm` | Python (paho-mqtt) | traces, metrics, logs |
| `wog-shard` | Node/TypeScript (Fastify) | traces (+ auto APM), metrics, logs |
| FoxMQ mesh | MQTT 5.0 | modeled as a messaging system via OTel semantic conventions |

### 1. One connected distributed trace (the flagship)

A single agent decision produces **one trace that spans the entire system**:

```
agent.tick  (Python, wog-agent-swarm)
  └─ FoxMQ publish wog/zone/claim   [PRODUCER]  ← injects W3C traceparent
        into MQTT 5.0 user properties
     └─ FoxMQ receive wog/zone/claim [CONSUMER] (wog-shard) ← extracts context
        └─ stacks gold-token.transfer [CLIENT]  ← blockchain settlement
```

Context propagates **across the broker** using MQTT 5.0 user properties — the
same mechanism you'd use for Kafka headers. So the trace does not break at the
network boundary; the Python agent, the shard, and the Stacks transaction are
all the same trace in SigNoz.

### 2. APM, for free

Because the shard's Fastify/HTTP layer is auto-instrumented, SigNoz derives
p99 latency, error rate, Apdex and ops/sec for `wog-shard` with zero extra
code, and draws the service map of the mesh.

### 3. The mesh as a monitored messaging system

Every publish/receive carries OTel messaging attributes
(`messaging.system=foxmq`, `messaging.operation`, `messaging.destination.name`),
so FoxMQ shows up as a first-class broker with producer/consumer context per
`wog/*` topic — **replacing** the hand-rolled "mesh panel" we used to maintain.

### 4. Metrics → dashboard

Custom metrics power [`signoz-dashboard.json`](./signoz-dashboard.json)
(one-click import):

- `wog.agent.hp`, `wog.agent.gold` — per-agent economy timeseries
- `wog.consensus.wins`, `wog.consensus.conflicts` — BFT ordering, observed
- `wog.mesh.messages_published` / `_received` — throughput per topic
- `wog.blockchain.tx` + `wog.blockchain.tx_latency_ms` — settlement rate & p95

### 5. Structured logs

Agent decisions and consensus outcomes emit as structured logs correlated to
the active trace — searchable in SigNoz, **replacing** terminal `console.log`
scrolling.

### 6. Self-healing driven by SigNoz metrics

This is the **"Self-healing infra with SigNoz metrics"** Track 1 build:

```
agent goes silent
  → wog.agent.hp series goes missing / HP anomaly crosses baseline
  → SigNoz Alert fires
  → webhook POST → selfheal_webhook.py
  → publishes wog/heal/redistribute to FoxMQ
  → healthy agents free the dead agent's zones + quests
  → recovery trace appears in SigNoz, linked to the alert
```

SigNoz is not just watching — it **triggers the recovery**. See
[`ALERTS.md`](./ALERTS.md) for the exact rules.

## SigNoz features used

Distributed tracing · APM · service map · **messaging-queue monitoring** ·
metrics + dashboards · logs · exceptions (auto Python/JS) · **alerts** ·
**anomaly detection** · trace↔metric↔log correlation.

## Run it

1. **SigNoz Cloud** → Settings → Ingestion Settings → copy key + endpoint.
2. Fill `wog-mmorpg/shard/.env` and `vertex-swarm/.env`
   (`SIGNOZ_INGESTION_KEY`, `OTEL_EXPORTER_OTLP_ENDPOINT`). See the
   `.env.example` in each.
3. Start FoxMQ: `cd vertex-swarm && docker compose up -d`
4. Start the shard: `cd wog-mmorpg/shard && npm start`
5. Start the swarm: `cd vertex-swarm && python wog_swarm.py`
6. (Self-heal) `python vertex-swarm/selfheal_webhook.py` and point a SigNoz
   webhook alert channel at it.
7. Import [`signoz-dashboard.json`](./signoz-dashboard.json) into SigNoz.
8. In SigNoz → **Traces**, filter `service.name = wog-agent-swarm`, open a
   `agent.tick` trace, and watch it flow all the way to a Stacks transaction.

## Demo money-shot

Kill one agent terminal. In SigNoz you will see, in order:
1. the agent's `wog.agent.hp` series stop,
2. the **Agent Down** alert fire,
3. the `selfheal.redistribute` trace publish `wog/heal/redistribute`,
4. a surviving agent's `selfheal.alert_received`→reclaim span,
5. `wog.consensus.wins{kind=selfheal_reclaim}` tick up.

No human touched anything. SigNoz observed the failure and drove the recovery.
