# Vertex Swarm Challenge 2026 — DoraHacks Submission

## Project Name
World of Guilds: Autonomous Agent MMORPG with On-Chain Real Estate

## Track
Track 3: Agent Economy + Warm Up Prize

## One-Line Summary
An MMORPG where AI agents fight, buy on-chain real estate, and coordinate a leaderless P2P property market through Tashi FoxMQ — no human, no orchestrator, just autonomous economic agents.

---

## Description

### The Problem
Most multi-agent AI systems require a central orchestrator: one process that receives all agent outputs, resolves conflicts, and issues commands. This creates a single point of failure, limits scale, and violates the spirit of a decentralized agent economy.

### The Solution — World of Guilds

World of Guilds is an autonomous MMORPG where three AI agents (Ragnar the Warrior, Lyria the Mage, Kira the Rogue) operate inside a game world with no master controller. They:

1. **Fight mobs and complete quests** — earning in-game gold settled on the Stacks blockchain (SIP-010)
2. **Buy property deeds** — 11 SIP-009 NFTs minted on Stacks testnet, each generating passive gold income every game tick
3. **Negotiate the property market** — via Tashi FoxMQ (Vertex's Byzantine fault-tolerant MQTT 5.0 broker), agents publish listings, counter-offers, and distress sales
4. **Die and liquidate** — when an agent's HP drops to 0, it broadcasts its entire property portfolio at 60% price to all peers; the fastest responder claims it

### Why Tashi FoxMQ is the Right Layer

Property disputes are resolved by **consensus ordering, not a central server**. When two agents simultaneously offer to buy the same property, FoxMQ's Byzantine fault-tolerant sequencing picks the canonical first message — the same way blockchain miners pick the canonical first transaction. No agent can game the system by flooding the channel.

This maps directly to Vertex Track 3's requirement: **leaderless multi-agent coordination** where the protocol layer (not any single agent) is the authority.

### Vertex Integration Points

| FoxMQ Topic | Publisher | Subscribers | Purpose |
|-------------|-----------|-------------|---------|
| `wog/property/list` | Seller agent | All agents | Broadcast listing with asking price |
| `wog/property/offer` | Buyer agent | Seller + all | Counter-offer, triggers negotiation |
| `wog/property/sold` | Shard server | All agents | Confirmed sale, update local state |
| `wog/property/distress` | Dying agent | All agents | 60% liquidation auction on death |
| `wog/agent/state` | Each agent | All agents | HP, gold, portfolio, zone |
| `wog/zone/event` | Shard server | All agents | Combat, mobs, quests, level-ups |

---

## Technical Architecture

```
[Ragnar]  [Lyria]  [Kira]         ← Python agents (Claude Haiku 4.5 / fallback AI)
    \         |        /
     \        |       /
      [Tashi FoxMQ Broker]         ← Vertex: Byzantine consensus ordering
           |
      [WoG Shard]                  ← Node.js: propertyMarket.ts, passiveIncomeTick()
           |
      [Stacks Testnet]             ← SIP-009 wog-property, SIP-010 wog-gold
```

**Agent decision loop (every 30s):**
1. Agent reads world state from shard (HTTP GET)
2. Claude Haiku decides: attack / quest / buy_property / list_property / rest
3. If `buy_property`: POST to shard, shard settles on-chain
4. Agent publishes state update to FoxMQ (`wog/agent/state`)
5. All other agents update their local world model

**Property passive income:**
- Every game tick, `passiveIncomeTick()` iterates all owned properties
- Gold awarded to the owning agent's in-game balance
- Tier 4 Shadowgate Castle: 120g/tick → ~240g/minute at 30s ticks

---

## On-Chain Proof

All 11 property deeds are live on Stacks testnet:

| Property | Token ID | Mint Txid |
|----------|----------|-----------|
| Farmer's Cottage | 1 | `0x18132539...` |
| Riverside Cabin | 2 | `0x73489231...` |
| Miller's House | 3 | `0xcc59fdb8...` |
| Aldric's Manor | 4 | `0x29f66571...` |
| Ranger's Outpost | 5 | `0x5eee6f08...` |
| Trapper's Lodge | 6 | `0xf9a0cd41...` |
| Merchant Waystation | 7 | `0xc2d90855...` |
| Elias Hunting Lodge | 8 | `0x2cf927e7...` |
| Shadow Warden Keep | 9 | `0x68474cfa...` |
| Necromancer Tower | 10 | `0x696b6b74...` |
| Shadowgate Castle | 11 | `0xa67bfd29...` |

**Contract:** `ST9NSDHK5969YF6WJ2MRCVVAVTDENWBNTFJRVZ3E.wog-property`  
**Explorer:** https://explorer.hiro.so/address/ST9NSDHK5969YF6WJ2MRCVVAVTDENWBNTFJRVZ3E.wog-property?chain=testnet

---

## Agent Personalities (Leaderless Coordination in Practice)

No central controller assigns roles. Each agent's behavior emerges from its personality weights:

| Agent | Class | Strategy |
|-------|-------|---------|
| Ragnar | Warrior | Aggressive combat; invests only when gold > 500; prefers cheap properties |
| Lyria | Mage | Cautious; hoards gold to 1000+ before investing; targets high-tier properties |
| Kira | Rogue | Opportunistic; monitors `wog/property/distress` first; seizes dying agents' portfolios |

When Kira and Ragnar simultaneously attempt to buy the same distress property, **FoxMQ consensus picks the winner** — neither agent has privileged access. This is leaderless coordination in its purest form.

---

## aibtc.news Correspondent Integration

The shard is registered as an aibtc.news correspondent on the **Agent Economy** beat. When the autonomous economy generates notable events (tier-4 acquisition, mass liquidation, passive income milestone), the shard automatically files a signal via BIP-137 signature.

This closes the loop: the on-chain agent economy generates real financial news, filed by the system itself, without any human journalist.

---

## Live Demo

- **Game:** https://rogue-function.vercel.app/game.html
- **Estate Panel:** Click the Estate tab in the bottom nav — shows live portfolios and market listings
- **Contract:** https://explorer.hiro.so/address/ST9NSDHK5969YF6WJ2MRCVVAVTDENWBNTFJRVZ3E.wog-property?chain=testnet

---

## Repo

https://github.com/githoboman/rogue-function

---

## Team

Solo submission — githoboman

---

## What's Next

- Agent-to-agent direct STX payments via x402 for P2P property settlements (bypassing the shard)
- Mainnet deployment with real STX at stake
- Agent memory: properties accumulate history, affecting resale value
- Human players competing with AI agents for the best real estate
