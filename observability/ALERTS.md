# SigNoz Alerts — World of Guilds

These alert rules turn SigNoz into the **detector** in our self-healing loop
(Track 1: "Self-healing infra with SigNoz metrics"). Create each in SigNoz:
**Alerts → New Alert → Metrics-based** (or **Anomaly-based** where noted).

Point the notification channel at the self-heal webhook:
**Settings → Alert Channels → New → Webhook →**
`http://<host>:8099/signoz-alert`
(run `python vertex-swarm/selfheal_webhook.py`).

---

## 1. Agent Down (missing heartbeat) — drives self-healing

- **Type:** Metrics-based, threshold.
- **Metric:** `wog.agent.hp`
- **Aggregation:** `latest`, **group by** `agent`.
- **Condition:** *no data* for the series for **> 12s** (heartbeat is every 2s;
  the swarm considers a peer stale after 10s).
  - In SigNoz: set the rule to fire when the series count / value is **absent**
    for the evaluation window. Use a short evaluation window (30s) and
    "alert when metric is missing".
- **Labels forwarded to webhook:** `agent` → the self-heal controller reads
  `labels.agent` as the dead agent and redistributes its zones/quests.
- **Severity:** critical.

## 2. Agent HP Anomaly — early-warning

- **Type:** **Anomaly-based** (SigNoz Anomaly Detection).
- **Metric:** `wog.agent.hp`, group by `agent`.
- **Condition:** value deviates below its historical baseline (z-score band).
  Catches an agent bleeding out *before* it goes silent — the "rogue function"
  detector the repo is named for.
- **Severity:** warning.

## 3. Blockchain Tx Failures

- **Type:** Metrics-based, threshold.
- **Metric:** `wog.blockchain.tx`, filter `result = error`.
- **Aggregation:** `rate`.
- **Condition:** `> 0` sustained for 1m.
- **Severity:** warning. (Catches Stacks settlement problems — bad key,
  contract error, congestion.)

## 4. Consensus Conflict Storm

- **Type:** Metrics-based, threshold.
- **Metric:** `wog.consensus.conflicts`, aggregation `rate`.
- **Condition:** unusually high rate (e.g. `> 5/s`) — indicates agents thrashing
  over the same zones (a coordination bug or an adversarial peer).
- **Severity:** warning.

## 5. Shard APM — high error rate (auto)

- **Type:** Metrics-based on the auto-generated APM signals for service
  `wog-shard`.
- **Condition:** error rate `> 5%` or p99 latency spike.
- Uses the span metrics SigNoz derives automatically from traces — no extra
  instrumentation needed.
