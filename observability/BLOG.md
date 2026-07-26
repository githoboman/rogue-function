# I built a leaderless AI agent economy. Then I spent a day just trying to *see* it.

*A hackathon debugging story: instrumenting a multi-agent MMORPG with OpenTelemetry and SigNoz — including all the dumb walls I hit on the way.*

> **Edit note for me before publishing:** rewrite chunks of this in my own voice, drop in the screenshots marked `[SCREENSHOT: ...]`, and cut anything that sounds too clean. Keep the war-story bits — those are the real ones.

---

## What I was building

For the Agents of SigNoz hackathon I built **World of Guilds** — three AI agents (Ragnar, Lyria, Kira) that fight monsters, do quests, and trade on-chain property in an MMORPG, with **no central server telling them what to do**. They coordinate over **Tashi FoxMQ**, an MQTT consensus mesh. If two agents grab the same zone, the consensus *ordering* of messages picks the winner. Cool idea.

The catch nobody warns you about: once you remove the orchestrator, you also remove the one place you could go to ask "what is happening right now?" A single agent decision touches four things — a Python process, the MQTT broker, a TypeScript game server, and a Stacks blockchain tx. When something breaks, the story is smeared across all four. I spent the first chunk of this hackathon basically blind, `console.log`-ing into three terminals at once.

So the real project became: **make this thing observable with SigNoz.** This post is how that went — wins and faceplants.

---

## Faceplant #1: my SigNoz key kept returning 401 and I couldn't figure out why

I signed up for SigNoz Cloud, grabbed my ingestion key, wired up the OpenTelemetry exporter, ran it… and every single span export failed:

```
Failed to export span batch code: 401, reason: Unauthorized
```

I assumed I'd copied the key wrong. Re-copied it. Still 401. I even tested it with a raw curl against the ingest endpoint:

```bash
curl -X POST "https://ingest.us.signoz.cloud:443/v1/traces" \
  -H "signoz-ingestion-key: <my-key>" \
  -H "Content-Type: application/json" -d '{"resourceSpans":[]}'
# HTTP 401
```

Tried the key against `us`, `eu`, and `in` regions — all 401. I was convinced the key was dead.

**The actual problem:** my workspace was on **`us2`**, not `us`. SigNoz has regional ingest hosts, and the endpoint the dashboard showed me was `ingest.us2.signoz.cloud`. The moment I switched:

```bash
curl -X POST "https://ingest.us2.signoz.cloud:443/v1/traces" ...
# HTTP 200  ✅
```

Lesson I'll never forget now: **the OTLP endpoint region has to exactly match your workspace's region.** Copy it from SigNoz → Settings → Ingestion Settings, don't guess `us`. This one cost me an hour.

`[SCREENSHOT: SigNoz → Settings → Ingestion Settings showing the us2 endpoint]`

---

## The setup that actually worked

Once the region was right, the Node side was clean. SigNoz authenticates OTLP ingestion with one header, `signoz-ingestion-key`:

```ts
// wog-mmorpg/shard/src/otel.ts  (imported FIRST, before Fastify/http)
const headers = { "signoz-ingestion-key": process.env.SIGNOZ_INGESTION_KEY };

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, headers }),
  metricReader:  new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics`, headers }),
  }),
  logRecordProcessors: [ new BatchLogRecordProcessor(
    new OTLPLogExporter({ url: `${endpoint}/v1/logs`, headers })) ],
  instrumentations: [ getNodeAutoInstrumentations() ],
});
sdk.start();
```

The `getNodeAutoInstrumentations()` line is the freebie of the century: my Fastify server immediately started showing up in SigNoz **APM** with p99 latency, error rate, and a service map — I wrote zero manual spans for that.

`[SCREENSHOT: SigNoz APM view for the wog-shard service — latency + error rate charts]`

---

## The part I actually cared about: one trace across the whole mesh

Here's the thing I wanted most and wasn't sure was even possible: **a single trace that follows one agent decision from the Python agent, across the MQTT broker, into the game server, all the way to the blockchain.**

The trick is propagating trace context *through* FoxMQ. MQTT 5.0 has "user properties" (basically headers), so I inject the W3C traceparent there when an agent publishes:

```python
# vertex-swarm/wog_swarm.py
with tracer.start_as_current_span("agent.publish") as span:
    span.set_attribute("messaging.system", "foxmq")
    span.set_attribute("messaging.destination.name", topic)
    span.set_attribute("messaging.operation", "publish")
    carrier = {}
    inject_context(carrier)                      # W3C traceparent → dict
    props.UserProperty = list(carrier.items())   # → MQTT5 user properties
    client.publish(topic, payload, properties=props)
```

And extract it on the TypeScript side when the shard receives the message, so the consumer span is a child of the agent's span:

```ts
// wog-mmorpg/shard/src/telemetry.ts
export function contextFromMqtt(userProperties): Context {
  return propagation.extract(context.active(), userProperties ?? {});
}
```

The first time this worked, the SigNoz trace waterfall showed the whole chain as ONE trace:

```
agent.tick                          (Python)
└─ FoxMQ publish wog/zone/claim     [PRODUCER]
   └─ FoxMQ receive wog/zone/claim  [CONSUMER]  (shard)
      └─ stacks gold-token.transfer  [CLIENT]   (blockchain)
```

That was the moment the black box cracked open. I could finally *see* a decision.

`[SCREENSHOT: the trace waterfall in SigNoz — agent → FoxMQ → shard → Stacks]`

Side note that tripped me: the messaging attributes (`messaging.system`, `messaging.operation`, `messaging.destination.name`) aren't decoration — SigNoz uses them to render the mesh as an actual **message-queue view**, per-topic. I got that for free just by following the OpenTelemetry messaging semantic conventions (I double-checked the attribute names against opentelemetry.io rather than trusting my memory).

---

## Faceplant #2: my agents were "thinking" but saying nothing

With telemetry flowing, I noticed my agents' decisions all looked like this in the logs:

```
[Ragnar] wait | default
[Lyria]  wait | default
[Kira]   wait | default
```

`default`. Every tick. That's the **fallback AI** — a dumb rule-based stand-in that kicks in when the real LLM call fails. So the LLM wasn't being called at all.

Two separate rabbit holes here:

**(a) My Anthropic API had no credits — but not the credits I thought I had.** I had ~$90 in my Claude *subscription*. Turns out the **API is a completely separate wallet** — subscription/usage credits don't pay for API calls. Every `/v1/messages` request came back "credit balance too low," even though `/v1/models` returned 200 (so the key was valid, just broke). That distinction is not obvious and cost me a while.

I ended up routing the agents through **NVIDIA's inference API** (free tier, OpenAI-compatible) instead. I made the LLM call provider-agnostic so I could swap by env var:

```ts
// LLM_BASE_URL + LLM_API_KEY → any OpenAI-compatible endpoint
const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
  method: "POST",
  headers: { Authorization: `Bearer ${LLM_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: AGENT_MODEL, messages: [...], max_tokens: 400 }),
});
```

**(b) A port mismatch made agents silently fall back even after that.** My shard and the agent "brain" run as **two separate processes**. The `.env` said `PORT=3001` and `SHARD_SERVER_URL=http://localhost:3001`, but I'd started the shard on `3000` by overriding PORT. So the agents were hitting `localhost:3001` → `ECONNREFUSED` → fallback. Nothing in the happy-path logs screamed this; I only caught it by reading the connection-refused lines. Started the shard on its real port and:

```
[Ragnar] attack | Bandit mob_22 is level 4, within safe combat range of
                  Ragnar's level 9, and closest at 6m distance
[Lyria]  attack | Closest Wild Boar for efficient farming
⚔️ [Ragnar] Killed Bandit (+30xp, +22g)
```

That's a *real* model reasoning about level, range, and distance. `default` → actual strategy. Huge difference, and I could confirm it in SigNoz because the decision spans now had content.

---

## Metrics, logs, and letting SigNoz heal the game

Once traces worked, I leaned into the rest of SigNoz.

**Custom metrics** for the economy — `wog.agent.hp`, `wog.agent.gold`, `wog.consensus.wins`, `wog.consensus.conflicts`, `wog.blockchain.tx_latency_ms` — which I wired into a dashboard so I can watch the whole autonomous economy on one screen.

`[SCREENSHOT: the WoG dashboard — agent gold/HP timeseries + consensus + tx latency]`

**Structured logs** replacing my `console.log` mess. Every consensus event carries an `event` field, so in SigNoz Logs I can filter `event = consensus.property.sold` and see exactly which agent won which auction — and jump to the trace that caused it.

`[SCREENSHOT: SigNoz Logs filtered to consensus.property.sold]`

**Self-healing driven by SigNoz.** This is my favorite part. Instead of the agents only detecting a dead peer themselves, I made a SigNoz **alert** the detector: a metrics-based rule on missing `wog.agent.hp` heartbeats (plus anomaly detection on HP, to catch an agent bleeding out before it goes fully silent). The alert hits a webhook that publishes a `wog/heal/redistribute` message to FoxMQ, and the surviving agents reclaim the dead one's zones and quests. The recovery then shows up as a fresh trace in SigNoz, linked back to the alert that caused it. SigNoz isn't just watching — it pulls the trigger.

---

## What I'd tell myself at the start

- **Copy the OTLP endpoint from your SigNoz settings, region and all.** Don't assume `us`. `us2` cost me an hour.
- **API credits ≠ subscription credits.** If you plan to drive agents with an LLM, budget for actual API credits or use a free OpenAI-compatible provider (NVIDIA worked great).
- **Trace context propagation is the whole game for distributed systems.** The instant I could carry a traceparent across MQTT, "who did what, in what order" became a diagram instead of a guess.
- **Read the sad-path logs.** My `ECONNREFUSED` was sitting right there while I stared at the happy path.
- **Instrument early.** I did the observability *after* building the mesh, and half my bugs would've been obvious in a trace on day one.

## Conclusion

SigNoz turned a genuinely undebuggable, leaderless multi-agent system into something I can watch, query, alert on, and even self-heal — all through OpenTelemetry, no lock-in. For autonomous agents, that visibility isn't a bonus feature; it's the only way I could tell whether the thing was actually working.

Repo: https://github.com/githoboman/rogue-function — the OTel setup is in `vertex-swarm/otel_swarm.py` and `wog-mmorpg/shard/src/otel.ts`.
