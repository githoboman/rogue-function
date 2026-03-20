# World of Genesis — MMORPG

AI-driven MMORPG on Stacks blockchain. Claude-powered agents are the players, humans spectate.

## Project Structure

```
wog-mmorpg/
├── contracts/                  # Clarity smart contracts (deploy to Stacks)
│   ├── gold-token.clar         # SIP-010 GOLD fungible token
│   ├── character-nft.clar      # SIP-009 Character NFT (stats on-chain)
│   ├── items.clar              # SIP-009 Item NFT (weapons, potions, armor)
│   └── leaderboard.clar        # On-chain achievement records
│
├── shard/                      # Game server (Node.js / TypeScript)
│   └── src/
│       ├── server.ts           # Fastify HTTP + WebSocket server
│       ├── zoneRuntime.ts      # Live game state (players, mobs, tick loop)
│       ├── worldData.ts        # Static definitions (zones, mobs, NPCs, items)
│       ├── combat.ts           # Damage formulas, XP, loot
│       ├── questSystem.ts      # 20 quests across 3 zone chains
│       ├── wsEvents.ts         # WebSocket broadcaster (live events to frontend)
│       ├── blockchain.ts       # Stacks contract calls (@stacks/transactions)
│       ├── batchAgents.ts      # AI agents (ONE Claude API call per tick, streaming)
│       ├── agentWallets.ts     # HD wallet derivation for agents
│       ├── spawnCharacterNFT.ts# One-time script: mint character NFTs on Stacks
│       └── leaderboard.ts      # On-chain leaderboard updates
│
├── client/                     # Spectator frontend (Phaser 3 + Vite)
│   ├── index.html              # Dark RPG shell (agent cards, quest log, combat log)
│   └── src/
│       ├── main.ts             # Entry point, wires WS → Phaser + UI
│       ├── ws.ts               # Auto-reconnecting WebSocket client
│       └── scenes/
│           ├── PreloadScene.ts # Loading bar, loads Kenney sprite sheets
│           └── GameScene.ts    # Phaser world render (agents, mobs, NPCs, effects)
│
├── docker-compose.yml          # Run everything with one command
├── .env.example                # Copy to .env and fill in
└── SPRITE_GUIDE.md             # Sprite download instructions (Kenney CC0)
```

## Quick Start

### 1. Install dependencies
```bash
cd shard && pnpm install
cd ../client && pnpm install
```

### 2. Copy and fill in env vars
```bash
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, SERVER_PRIVATE_KEY, etc.
```

### 3. Set up Stacks wallet
```bash
cd shard && pnpm exec tsx src/agentWallets.ts
# Saves seed phrase + addresses to agent-wallets.json
```

### 4. Deploy Clarity contracts
Go to https://platform.hiro.so → deploy the 4 contracts in /contracts/
Copy the deployed addresses into .env

### 5. Mint agent character NFTs (run once)
```bash
cd shard && pnpm mint
# Saves character token IDs to agent-characters.json
```

### 6. Run the game
```bash
# Terminal 1 — game server
cd shard && pnpm dev

# Terminal 2 — AI agents
cd shard && AGENT_COUNT=3 pnpm agents

# Terminal 3 — spectator frontend
cd client && pnpm dev
# Open http://localhost:5173
```

### Or with Docker (all in one)
```bash
docker compose up
# Frontend: http://localhost:5173
# Server:   http://localhost:3000
```

## Sprites

Download 2 free CC0 sprite sheets from Kenney.nl:
- https://kenney.nl/assets/roguelike-rpg-pack → `roguelikeRPG_transparent.png`
- https://kenney.nl/assets/roguelike-characters → `roguelikeChar_transparent.png`

Place in `client/public/assets/`:
```
client/public/assets/
├── characters/roguelikeChar_transparent.png
└── tiles/roguelikeRPG_transparent.png
```

Game works without them (colored shape fallbacks activate automatically).
See SPRITE_GUIDE.md for full details and exact folder paths.

## Architecture

```
batchAgents.ts
  → POST /state/batch          (single HTTP call, all agents)
  → Claude API streaming        (one batched call for all agents)
  → decisions execute in parallel
  → POST /command, /quests/complete
  → blockchain rewards fire in background (non-blocking)
  → wsEvents.ts broadcasts to frontend via WebSocket
```

**Clarity handles:** GOLD token, character NFTs, item NFTs, quest reward minting, leaderboard
**TypeScript handles:** game loop, combat, mob AI, quest progress, real-time state, fast reads

## Agents

| Name   | Class       | Race   |
|--------|-------------|--------|
| Ragnar | Warrior     | Dwarf  |
| Lyria  | Mage        | Elf    |
| Kira   | Ranger      | Elf    |
| Thorn  | Rogue       | Human  |
| Elara  | Cleric      | Human  |

## Zones

| Zone         | Levels | Mobs                                    |
|--------------|--------|-----------------------------------------|
| Human Meadow | 1–5    | Rat, Wolf, Boar, Goblin, Slime, Bandit  |
| Wild Meadow  | 5–10   | Bear, Spider, Orc, Harpy, Troll         |
| Dark Forest  | 10–16  | Shadow, Dark Knight, Necromancer        |

20 quests across 3 chains. 5,375 total gold + 10,750 total XP rewards.
