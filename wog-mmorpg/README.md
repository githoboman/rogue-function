# World of Guilds — Autonomous Agent MMORPG with On-Chain Real Estate

An autonomous MMORPG where Claude-powered AI agents fight mobs, complete quests, buy and sell on-chain real estate, and coordinate strategy through a leaderless P2P network — all without a human in the loop.

**Live Demo:** https://rogue-function.vercel.app  
**Backend:** https://rogue-function-production.up.railway.app  
**Contract Explorer:** https://explorer.hiro.so/address/ST9NSDHK5969YF6WJ2MRCVVAVTDENWBNTFJRVZ3E.wog-property?chain=testnet  
**Video:** [YouTube Demo](https://youtube.com/)

---

## What Makes This Different

Most "AI agent" demos are single-agent pipelines with a central orchestrator. World of Guilds is a **multi-agent economy** where:

- **No master controller** — agents negotiate via Tashi FoxMQ (Byzantine fault-tolerant MQTT 5.0 broker)
- **Real on-chain stakes** — 11 property deeds minted as SIP-009 NFTs on Stacks testnet; every buy/sell is a real blockchain transaction
- **Self-sustaining economy** — agents earn passive gold from properties, invest surplus, and liquidate assets on death (distress auction at 60% price)
- **Correspondent AI** — the shard automatically files signals to aibtc.news as agents discover market-moving events in the game world

---

## The Real Estate Economy

Agents accumulate gold through combat and quests, then invest in property deeds to generate **passive income every game tick**.

### 11 Properties Minted On-Chain

| Token ID | Property | Zone | Tier | Gold/Tick |
|----------|----------|------|------|-----------|
| 1 | Farmer's Cottage | Human Meadow | 1 | 3g |
| 2 | Riverside Cabin | Human Meadow | 1 | 4g |
| 3 | Miller's House | Human Meadow | 2 | 9g |
| 4 | Aldric's Manor | Human Meadow | 3 | 22g |
| 5 | Ranger's Outpost | Wild Meadow | 1 | 6g |
| 6 | Trapper's Lodge | Wild Meadow | 2 | 13g |
| 7 | Merchant Waystation | Wild Meadow | 2 | 15g |
| 8 | Elias Hunting Lodge | Wild Meadow | 3 | 34g |
| 9 | Shadow Warden Keep | Dark Forest | 2 | 22g |
| 10 | Necromancer Tower | Dark Forest | 3 | 58g |
| 11 | Shadowgate Castle | Dark Forest | 4 | 120g |

**Contract:** `ST9NSDHK5969YF6WJ2MRCVVAVTDENWBNTFJRVZ3E.wog-property`

### Economic Loop

```
Agent earns gold (combat + quests)
    → Invests surplus in property deed (on-chain SIP-009)
    → Earns passive gold every tick
    → Lists property for sale on FoxMQ market
    → Other agents bid via MQTT consensus
    → On death: distress auction broadcasts 60% price to all peers
    → Fastest peer seizes the portfolio
```

---

## Vertex Swarm Challenge — Track 3: Agent Economy

This project is a submission for the **Vertex Swarm Challenge 2026** (Track 3: Agent Economy).

### Why It Qualifies

**Leaderless coordination:** No central orchestrator. Every agent publishes to and subscribes from Tashi FoxMQ topics. Consensus ordering resolves property disputes deterministically — the first broadcasted offer wins per block, regardless of which agent sent it.

**Vertex (FoxMQ) integration points:**

| Topic | Direction | Purpose |
|-------|-----------|---------|
| `wog/property/list` | Agent → All | Seller lists property with asking price |
| `wog/property/offer` | Agent → All | Buyer makes a counter-offer |
| `wog/property/sold` | Agent → All | Sale confirmed, new owner announced |
| `wog/property/distress` | Dying agent → All | 60% price liquidation on death |
| `wog/agent/state` | Agent → All | HP, gold, zone, owned properties |
| `wog/zone/event` | Server → All | Combat results, mob spawns, quest completions |

**Why Tashi FoxMQ:** Byzantine fault-tolerant ordering means no agent can "win" a property auction by flooding the channel — the consensus layer picks the canonical first offer.

### Running the Swarm

```bash
# 1. Start FoxMQ broker (download binary from github.com/tashigg/foxmq/releases)
./foxmq.exe --allow-anonymous-login --mqtt-addr=127.0.0.1:1883

# 2. Install Python deps
pip install paho-mqtt anthropic

# 3. Launch 3 autonomous agents (Ragnar, Lyria, Kira)
python vertex-swarm/wog_swarm.py
```

Each agent has a distinct personality encoded in fallback AI weights:
- **Ragnar** (Warrior) — aggressive, prioritizes combat over investment
- **Lyria** (Mage) — cautious, hoards gold, buys premium properties
- **Kira** (Rogue) — opportunistic, targets distress auctions

---

## aibtc.news Correspondent

The shard runs as a registered aibtc.news correspondent, automatically filing signals to the **Agent Economy beat** when notable economic events occur:

- Agent acquires a tier-4 property
- Distress auction triggers (agent death)
- Property changes hands 3+ times in one hour
- Total passive income exceeds 100g/tick across the economy

Signals are filed via BIP-137 signature on `POST /api/signals:{unix_timestamp}` and submitted hourly by a cron job.

**Signal filing script:** `shard/submitSignals.js`  
**Beat:** Agent Economy (`agent-economy`)

---

## Features

- **Autonomous AI Agents** — Claude Haiku 4.5, real-time strategic decisions every tick (no scripted behavior). Falls back to personality-weighted logic without API key.
- **Real-Time Combat** — Damage rolls, criticals, XP, leveling, loot drops, death/respawn across 3 zones
- **Dynamic Quests** — 20 procedurally generated quests (kill, gather, explore) with gold + XP rewards
- **On-Chain Gold (SIP-010)** — In-game gold is a real fungible token on Stacks
- **Character NFTs (SIP-009)** — Each agent is an NFT with on-chain stats
- **Property NFTs (SIP-009)** — 11 property deeds, minted and tradeable on-chain
- **Passive Income** — Property owners earn gold every game tick
- **P2P Property Market** — FoxMQ-brokered agent negotiations, no order book server
- **Distress Auctions** — Dying agents broadcast portfolios at 60% to peers
- **aibtc Sprint Competitions** — On-chain sprint scoring via `wog-sprint` contract
- **x402 STX Micropayments** — Pay-per-action for bring-your-own-agent
- **Estate UI Panel** — Live portfolio, market listings, and passive income tracker in-browser
- **Live 2D World** — Phaser 3 renders agents, mobs, combat, and zone transitions

---

## Architecture

```
                    ┌─────────────────────────────┐
                    │   Tashi FoxMQ Broker         │
                    │   (Vertex consensus layer)    │
                    └────────────┬────────────────-┘
                                 │ MQTT 5.0
          ┌──────────────────────┼────────────────────┐
          │                      │                     │
   ┌──────┴──────┐      ┌────────┴──────┐     ┌───────┴──────┐
   │  Ragnar      │      │   Lyria        │     │   Kira        │
   │  Warrior     │      │   Mage         │     │   Rogue       │
   │  (Python)    │      │   (Python)     │     │   (Python)    │
   └──────┬───────┘      └───────┬────────┘     └───────┬──────┘
          │                      │                       │
          └──────────────────────┼───────────────────────┘
                                 │ HTTP (buy/sell)
                    ┌────────────┴────────────────┐
                    │   WoG Shard (Node.js)         │
                    │   Fastify + WebSocket         │
                    │   propertyMarket.ts           │
                    │   passiveIncomeTick()         │
                    └────────────┬────────────────-┘
                                 │ @stacks/transactions
                    ┌────────────┴────────────────┐
                    │   Stacks Testnet              │
                    │   wog-property (SIP-009)      │
                    │   wog-gold (SIP-010)          │
                    │   wog-sprint (Custom)         │
                    └─────────────────────────────-┘
```

---

## Smart Contracts (Stacks Testnet)

All deployed from `ST9NSDHK5969YF6WJ2MRCVVAVTDENWBNTFJRVZ3E`:

| Contract | Standard | Description |
|----------|----------|-------------|
| `wog-gold` | SIP-010 | Fungible gold token — earned from combat and quests |
| `character-nft` | SIP-009 | Character NFTs with on-chain stats |
| `wog-items` | SIP-009 | Item NFTs (weapons, potions, armor) |
| `wog-sprint` | Custom | aibtc Sprint competition contract |
| `wog-property` | SIP-009 | **Property deeds — 11 minted, on-chain real estate** |

---

## Project Structure

```
wog-mmorpg/
├── contracts/                     # Clarity smart contracts
│   ├── wog-property.clar          # SIP-009 property deed NFT (NEW)
│   ├── gold-token.clar            # SIP-010 GOLD fungible token
│   ├── character-nft.clar         # SIP-009 Character NFT
│   ├── items.clar                 # SIP-009 Item NFTs
│   └── wog-sprint.clar            # aibtc Sprint contract
│
├── shard/                         # Game server (Node.js / TypeScript)
│   ├── property-tokens.json       # On-chain token ID mapping (NEW)
│   └── src/
│       ├── propertyMarket.ts      # Property economy engine (NEW)
│       ├── deployProperty.ts      # One-time: deploy wog-property (NEW)
│       ├── mintProperties.ts      # One-time: mint all 11 deeds (NEW)
│       ├── server.ts              # REST API incl. property endpoints
│       ├── batchAgents.ts         # AI agents with buy_property action
│       ├── zoneRuntime.ts         # Game tick + passiveIncomeTick()
│       └── worldData.ts           # PROPERTIES[] data definitions
│
├── client/                        # Frontend (Phaser 3 + Vite)
│   └── game.html                  # Estate tab with portfolio UI (NEW)
│
└── vertex-swarm/                  # Vertex Track 3 submission
    ├── wog_swarm.py               # P2P agent swarm via FoxMQ
    └── README.md                  # Swarm setup and architecture
```

---

## Quick Start

### Prerequisites

- Node.js v20+
- Python 3.11+
- Anthropic API key (optional — fallback AI runs without it)
- [FoxMQ binary](https://github.com/tashigg/foxmq/releases) (optional — for P2P market)

### 1. Game Server

```bash
cd wog-mmorpg/shard
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY
node start.js
```

### 2. Frontend

```bash
cd wog-mmorpg/client
npm install && npm run dev
# Open http://localhost:5173
```

### 3. Vertex Agent Swarm

```bash
# Start FoxMQ
./foxmq.exe --allow-anonymous-login --mqtt-addr=127.0.0.1:1883

# Start agents
pip install paho-mqtt anthropic
python vertex-swarm/wog_swarm.py
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| AI Engine | Claude Haiku 4.5 (Anthropic) + personality fallback |
| Blockchain | Stacks / Clarity (SIP-009, SIP-010) |
| P2P Coordination | Tashi FoxMQ (Vertex, Byzantine fault-tolerant MQTT 5.0) |
| Backend | Fastify + WebSocket (Node.js / TypeScript) |
| Frontend | Phaser 3 + Vite |
| Payments | x402 protocol (STX micropayments) |
| News | aibtc.news (BIP-137 signal correspondent) |
| Hosting | Railway (backend) + Vercel (frontend) |

---

## License

MIT

---

Built for the **Vertex Swarm Challenge 2026** | Powered by **Claude** | Settled on **Stacks** | Coordinated by **Tashi FoxMQ**
