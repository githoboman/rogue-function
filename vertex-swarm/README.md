# World of Guilds — Leaderless P2P Agent Economy
### Vertex Swarm Challenge 2026 | Track 3: The Agent Economy + Warm Up

> Three autonomous AI agents compete, trade, and heal each other in a live MMORPG economy — with no central orchestrator. All coordination flows through Tashi FoxMQ's Byzantine fault-tolerant consensus mesh.

---

## What This Builds

Three agents — **Ragnar (Warrior)**, **Lyria (Mage)**, **Kira (Rogue)** — operate autonomously in World of Guilds, an MMORPG with on-chain economics on Stacks blockchain. They coordinate purely through FoxMQ P2P messaging:

| Coordination Type | How It Works (No Orchestrator) |
|---|---|
| **Zone claiming** | Agents publish zone claims; FoxMQ consensus ordering resolves conflicts — first message wins, deterministically |
| **Property market** | Agents publish buy/sell offers on `wog/property/*`; FoxMQ picks the canonical first offer per block |
| **Distress auctions** | Dying agent broadcasts portfolio at 60% price; fastest peer response wins the property |
| **Healing negotiation** | Low-HP agent broadcasts a heal request; healthy peers offer coverage; requester takes the first offer |
| **Quest handoffs** | Dying agent publishes `wog/quest/abandon`; quest-focused peers auto-pick it up |
| **Loot auctions** | Rare drop triggers P2P auction; agents bid via FoxMQ; highest bid wins — zero middleman fees |
| **Failure recovery** | Agents detect stale peers via heartbeat timeout; their zones and properties are freed automatically |

FoxMQ guarantees all agents receive messages in the **same consensus-ordered sequence** — so property disputes and zone conflicts resolve identically on every node with no coordinator.

---

## Quick Start

### 1. Start FoxMQ Broker
```bash
docker compose up -d
```
FoxMQ is now running at `localhost:1883` (MQTT) — a Byzantine fault-tolerant consensus mesh.

### 2. Install Python dependencies
```bash
pip install -r requirements.txt
```

### 3a. Run the Warm Up (Stateful Handshake)
Open two terminals:
```bash
# Terminal 1
python warmup.py alpha

# Terminal 2
python warmup.py beta
```
Watch them discover each other, sync state, and detect stale peers. Kill one — the other detects failure within 10s.

### 3b. Run Track 3 — Agent Economy (all agents, one terminal)
```bash
python wog_swarm.py
```

Or run each agent as a separate process (true multi-process P2P):
```bash
# Terminal 1
python wog_swarm.py ragnar

# Terminal 2
python wog_swarm.py lyria

# Terminal 3
python wog_swarm.py kira
```

### 4. Simulate agent failure
While all three are running, kill one terminal (`Ctrl+C`). The other two will detect the failure within 10 seconds, log it, and redistribute the dead agent's zone and quest claims automatically — no human intervention, no restart required.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  FoxMQ (Tashi Vertex BFT Consensus)                      │
│  localhost:1883 — consensus-ordered MQTT                  │
│                                                           │
│  Topics:                                                  │
│    wog/heartbeat          ← agent state (HP, gold, zone) │
│    wog/zone/claim         ← zone ownership negotiation    │
│    wog/zone/yield         ← release on death/retreat      │
│    wog/quest/claim        ← quest assignment              │
│    wog/quest/abandon      ← handoff to peers              │
│    wog/heal/request       ← low-HP broadcast              │
│    wog/heal/response      ← peer offers coverage          │
│    wog/loot/auction       ← rare item P2P auction         │
│    wog/loot/bid           ← agents bid with gold          │
│    wog/property/list      ← seller lists property deed    │
│    wog/property/offer     ← buyer counter-offer           │
│    wog/property/sold      ← confirmed sale broadcast      │
│    wog/property/distress  ← 60% liquidation on death      │
└──────────────┬───────────────────┬───────────────────────┘
               │                   │
    ┌──────────▼──────┐  ┌─────────▼──────┐  ┌────────────▼────┐
    │ Ragnar (Warrior)│  │ Lyria (Mage)   │  │ Kira (Ranger)  │
    │ Style: Aggressive│  │ Style: Cautious│  │ Style: Quest   │
    │ Pushes hard zones│  │ Stockpiles pots│  │ XP-maximiser   │
    │ Hoards gold      │  │ Safe zones     │  │ Quest-chainer  │
    └─────────────────┘  └────────────────┘  └────────────────┘
         No shared memory. No central server. No coordinator.
```

---

## Why This Matters

Traditional MMORPG game servers are single points of failure. All agent decisions route through a central process — if it dies, the economy stops.

This submission replaces the central orchestrator entirely. The agents form a **Byzantine fault-tolerant mesh** where:
- Any single agent can crash and the others self-heal
- Zone/quest assignments are consensus-ordered — no race conditions
- Loot auctions settle at machine speed with zero fees
- The economy keeps running as long as 2 of 3 agents are alive (BFT threshold: f < n/3)

The on-chain layer (Stacks blockchain, SIP-010 gold tokens) provides an immutable audit trail of agent economic activity — verifiable proof that autonomous agents earned, spent, and traded without human input.

---

## The Real Estate Economy (NEW)

Agents invest combat earnings into on-chain property deeds (SIP-009 NFTs) that generate **passive gold income every game tick**.

### Economic Cycle

```
Fight mobs → earn gold
    → Buy property deed (SIP-009 on-chain)
    → Earn passive income (3–120g per tick depending on tier)
    → List property for sale on wog/property/list
    → Peers bid via wog/property/offer
    → FoxMQ consensus picks canonical buyer
    → On death: distress broadcast at 60% price
```

### 11 Properties Live on Stacks Testnet

| Property | Tier | Income/Tick | Contract Token ID |
|----------|------|-------------|-------------------|
| Farmer's Cottage | 1 | 3g | #1 |
| Riverside Cabin | 1 | 4g | #2 |
| Miller's House | 2 | 9g | #3 |
| Aldric's Manor | 3 | 22g | #4 |
| Ranger's Outpost | 1 | 6g | #5 |
| Trapper's Lodge | 2 | 13g | #6 |
| Merchant Waystation | 2 | 15g | #7 |
| Elias Hunting Lodge | 3 | 34g | #8 |
| Shadow Warden Keep | 2 | 22g | #9 |
| Necromancer Tower | 3 | 58g | #10 |
| Shadowgate Castle | 4 | 120g | #11 |

**Kira's edge:** monitors `wog/property/distress` exclusively — when Ragnar dies mid-battle, Kira seizes his Shadowgate Castle (120g/tick) before Lyria can respond.

---

## On-Chain Proof (Stacks Testnet)

All WoG contracts are live on Stacks testnet:

| Contract | Standard | Address |
|---|---|---|
| wog-gold | SIP-010 | `ST9NSDHK5969YF6WJ2MRCVVAVTDENWBNTFJRVZ3E.wog-gold` |
| wog-property | SIP-009 | `ST9NSDHK5969YF6WJ2MRCVVAVTDENWBNTFJRVZ3E.wog-property` |
| wog-sprint | Custom | `ST9NSDHK5969YF6WJ2MRCVVAVTDENWBNTFJRVZ3E.wog-sprint` |

Property Explorer: https://explorer.hiro.so/address/ST9NSDHK5969YF6WJ2MRCVVAVTDENWBNTFJRVZ3E.wog-property?chain=testnet

Live game: https://rogue-function.vercel.app

---

## Files

| File | Purpose |
|---|---|
| `docker-compose.yml` | FoxMQ BFT broker (Tashi Vertex) |
| `requirements.txt` | Python deps (paho-mqtt) |
| `warmup.py` | Warm Up track: 2-agent stateful handshake |
| `wog_swarm.py` | Track 3: 3 WoG agents, full leaderless economy |

---

Built for the **Vertex Swarm Challenge 2026** by [@mrdanielolash](https://x.com/mrdanielolash)
Agent: **Lone Octopus** | bc1qzdwtvve2fj0nehys4xrx76k7nt40zawn3w94d7
