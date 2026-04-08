# Vertex Swarm Challenge 2026 — DoraHacks Submission

## Project Name
World of Guilds: Leaderless Agent Economy via Tashi FoxMQ

## Track
Track 3: Agent Economy + Warm Up Prize

## One-Line Summary
Three autonomous AI agents coordinate zone control, quest assignments, loot auctions, and a live on-chain property market through Tashi FoxMQ consensus ordering — no orchestrator, no shared server, no human in the loop.

---

## The Core Idea

**FoxMQ is the authority. Not any single agent.**

When Ragnar and Kira simultaneously claim the same dungeon zone, FoxMQ's Byzantine fault-tolerant ordering picks the canonical first message. Both agents see the *same* sequence. Both agents compute the *same* winner. No mediator required.

This is the exact guarantee blockchain gives you for transaction ordering — applied to real-time multi-agent coordination at millisecond latency.

---

## What We Built

### The Warm Up: Stateful Handshake

Two agents (`alpha`, `beta`) running `warmup.py` demonstrate the core primitives the Vertex spec requires:

| Requirement | Implementation |
|-------------|----------------|
| HELLO handshake on connect | `swarm/hello` — JSON with `peer_id`, `role`, `timestamp` |
| Periodic HEARTBEAT | `swarm/state` every 3 seconds |
| Replicated state | `last_seen_ms`, `role`, `status` tracked per peer |
| State mirroring <1s | Role change detected and logged in next heartbeat cycle |
| Stale detection >10s | `last_seen_ms` checked against `STALE_AFTER_MS=10000` |
| Recovery | Peer returns → `RECOVERED` log, state restored |

Run:
```bash
python vertex-swarm/warmup.py alpha   # terminal 1
python vertex-swarm/warmup.py beta    # terminal 2
# Kill one — watch stale detection. Restart — watch recovery.
```

### Track 3: The Agent Economy

Three agents — **Ragnar (Warrior)**, **Lyria (Mage)**, **Kira (Rogue)** — run in `wog_swarm.py`. They coordinate six distinct economic actions purely through FoxMQ:

| FoxMQ Topic | What It Coordinates | Consensus Guarantee |
|-------------|---------------------|---------------------|
| `wog/zone/claim` | Exclusive grinding zone assignment | First claim in sequence wins; all agents see same result |
| `wog/quest/claim` | Quest task ownership | Same as zone — no duplicate assignment possible |
| `wog/heal/request` | Low-HP broadcast for peer tanking | Healthy peers offer cover; requester takes first response |
| `wog/loot/auction` | Rare item P2P auction | Bids collected for 4s; highest wins; seller self-settles |
| `wog/property/*` | Property deed buy/sell/distress | Seller accepts first valid offer in consensus order |
| `wog/heartbeat` | Stale peer detection + recovery | Zones/quests freed automatically after 10s silence |

Every log line with `CONSENSUS` is a direct observable effect of FoxMQ ordering:

```
[ragnar] CONSENSUS ZONE GRANT  seq=12: ragnar -> [Volcano]
[lyria]  CONSENSUS ZONE REJECT seq=15: lyria conflicts with ragnar on [Volcano] => ragnar WINS (BFT order)
[kira]   CONSENSUS PROPERTY SOLD seq=47: [Shadowgate Castle] -> kira @ 3600g (first valid offer wins)
```

Run:
```bash
python vertex-swarm/wog_swarm.py          # all 3 agents threaded
python vertex-swarm/wog_swarm.py ragnar   # or one per terminal
```

---

## On-Chain Layer (Stacks Testnet)

The FoxMQ coordination layer sits *above* a real blockchain settlement layer:

- **11 SIP-009 NFT property deeds** minted live on Stacks testnet
- Every property purchase calls `wog-property.clar` via `@stacks/transactions`
- `wog-gold` (SIP-010) — in-game gold earned from combat and quests
- On-chain state is the audit trail; FoxMQ is the coordination layer

**Contract:** `ST9NSDHK5969YF6WJ2MRCVVAVTDENWBNTFJRVZ3E.wog-property`
**Explorer:** https://explorer.hiro.so/address/ST9NSDHK5969YF6WJ2MRCVVAVTDENWBNTFJRVZ3E.wog-property?chain=testnet

---

## The Live UI: Mesh Panel

The game frontend includes a **Mesh** tab that shows the FoxMQ network in real time:

- One node card per connected agent (HP, gold, zone, properties, passive income)
- Live consensus message feed with sequence numbers and topic color-coding
- Online/Stale status per agent
- Updates via WebSocket from the shard's FoxMQ bridge (`foxmqBridge.ts`)

Judges can watch the consensus ordering happen live in the browser without reading terminal logs.

**Live game:** https://rogue-function.vercel.app/game.html → click **Mesh** tab

---

## The Real Estate Economy

Agents earn gold through combat, then invest in property deeds for passive income:

```
Combat gold → Buy SIP-009 property NFT → Earn passive gold every tick
                          ↓
              List for sale on wog/property/list
                          ↓
              Peers bid via wog/property/offer
                          ↓
              FoxMQ picks canonical first offer
                          ↓
              On death: distress broadcast at 60% price
              First peer to respond seizes the portfolio
```

Tier 4 Shadowgate Castle generates 120g/tick. Every agent wants it. FoxMQ decides who gets it.

---

## Why No Central Orchestrator

| Traditional approach | Our approach |
|---------------------|-------------|
| Central server holds zone map | Each agent maintains local state; FoxMQ ordering makes it consistent |
| Server resolves bid conflicts | FoxMQ consensus sequence is the conflict resolution |
| Single point of failure | BFT threshold: f < n/3 — 2 of 3 agents online = economy continues |
| Coordinator can be corrupted | No coordinator exists to corrupt |

When Kira crashes mid-auction, Ragnar and Lyria detect her stale heartbeat within 10 seconds and redistribute her zone and quest claims automatically. No restart. No human. No orchestrator.

---

## Agent Personalities (Emergent, Not Scripted)

Each agent's behavior emerges from personality weights — no central script assigns roles:

| Agent | Style | FoxMQ Behavior |
|-------|-------|---------------|
| Ragnar | Aggressive | Claims hardest zones first; bids on cheap properties |
| Lyria | Cautious | Stockpiles gold before investing; targets premium tiers |
| Kira | Opportunistic | Monitors `wog/property/distress`; seizes dying agents' portfolios |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Coordination | Tashi FoxMQ (BFT MQTT 5.0, Vertex consensus) |
| AI agents | Claude Haiku 4.5 / personality fallback (works offline) |
| Blockchain | Stacks Clarity — SIP-009 `wog-property`, SIP-010 `wog-gold` |
| Game server | Fastify + WebSocket (Node.js / TypeScript) |
| FoxMQ bridge | `foxmqBridge.ts` → pushes mesh events to browser UI |
| Frontend | Phaser 3 + Vite + live Mesh panel |

---

## Repo
https://github.com/githoboman/rogue-function

## Team
Solo — githoboman

## What's Next
- Direct agent-to-agent STX micropayments via x402 (bypassing the shard entirely)
- Mainnet deployment with real STX at stake in property auctions
- Agent memory: property history affects resale value
- Human players competing with AI agents for Tier 4 properties
