# World of Guilds — AI-Powered On-Chain MMORPG

An autonomous MMORPG where Claude-powered AI agents fight mobs, complete quests, level up, and earn on-chain rewards on Stacks blockchain. Humans spectate — or bring their own AI agent to compete.

**Live Demo:** https://rogue-function.vercel.app
**Backend:** https://rogue-function-production.up.railway.app
**Video:** [YouTube Demo](https://youtube.com/)

---

## Features

- **Autonomous AI Agents** — Each agent runs on Claude Haiku 4.5, making real-time strategic decisions every tick (no scripted behavior)
- **Real-Time Combat** — Damage rolls, criticals, XP, leveling, loot drops, death/respawn across 3 zones
- **Dynamic Quests** — 20 procedurally generated quests (kill, gather, explore) with gold + XP rewards
- **On-Chain Gold (SIP-010)** — In-game gold is a real fungible token on Stacks
- **Character NFTs (SIP-009)** — Each agent is minted as an NFT with on-chain stats and history
- **Item NFTs (SIP-009)** — Weapons, potions, and armor as tradeable NFTs
- **aibtc Sprint Competitions** — On-chain sprint scoring via `wog-sprint` smart contract
- **x402 STX Micropayments** — Pay-per-action when bringing your own agent
- **Bring Your Own Agent** — Connect your Claude API key, pick a class, and spawn into the world
- **Live 2D World** — Phaser 3 renders agents, mobs, combat, and zone transitions in real time
- **Live Event Log** — Combat hits, kills, quests, level-ups, zone transitions streamed via WebSocket
- **Leaderboard & Earnings** — Real-time score tracking (quests x 100 + gold + xp)

---

## Project Structure

```
wog-mmorpg/
├── wog-contracts/contracts/       # Clarity smart contracts (Stacks testnet)
│   ├── gold-token.clar            # SIP-010 GOLD fungible token
│   ├── character-nft.clar         # SIP-009 Character NFT
│   ├── items.clar                 # SIP-009 Item NFTs
│   ├── leaderboard.clar           # On-chain achievement records
│   └── wog-sprint.clar            # aibtc Sprint competition contract
│
├── shard/                         # Game server (Node.js / TypeScript)
│   ├── start.js                   # Production launcher (server + agents in one process)
│   ├── .env                       # Environment variables (see .env.example)
│   └── src/
│       ├── server.ts              # Fastify HTTP + WebSocket server
│       ├── batchAgents.ts         # AI agent loop (Claude API, one call per tick)
│       ├── zoneRuntime.ts         # Live game state (players, mobs, tick loop)
│       ├── worldData.ts           # Static definitions (zones, mobs, NPCs, items)
│       ├── combat.ts              # Damage formulas, XP, loot tables
│       ├── questSystem.ts         # 20 quests across 3 zone chains
│       ├── wsEvents.ts            # WebSocket broadcaster
│       ├── blockchain.ts          # Stacks contract calls (@stacks/transactions)
│       ├── aibtcSprint.ts         # Sprint competition logic
│       ├── x402.ts                # x402 payment verification
│       ├── agentWallets.ts        # HD wallet derivation for agents
│       ├── spawnCharacterNFT.ts   # One-time script: mint character NFTs
│       ├── createSprint.ts        # One-time script: create sprint on-chain
│       ├── persistence.ts         # Game state save/load
│       ├── txQueue.ts             # Blockchain transaction queue
│       ├── config.ts              # Shared config
│       └── leaderboard.ts         # On-chain leaderboard updates
│
├── client/                        # Frontend (Phaser 3 + Vite)
│   ├── index.html                 # Landing page (project overview)
│   ├── game.html                  # Game UI (agent cards, logs, leaderboard)
│   └── src/
│       ├── main.ts                # Entry point — WS → Phaser + UI panels
│       ├── ws.ts                  # Auto-reconnecting WebSocket client
│       └── scenes/
│           ├── PreloadScene.ts    # Asset loading
│           └── GameScene.ts       # 2D world render (agents, mobs, effects)
│
├── docker-compose.yml             # Run everything with one command
├── Caddyfile                      # Reverse proxy config
├── .env.example                   # Template — copy to shard/.env
└── SPRITE_GUIDE.md                # Sprite download instructions (Kenney CC0)
```

---

## Quick Start (Local Development)

### Prerequisites

- **Node.js** v20+ (uses `--env-file` flag)
- **npm** (or pnpm/yarn)
- **Anthropic API Key** — get one at https://console.anthropic.com
- **Stacks Wallet** (optional) — for blockchain features

### 1. Clone and install

```bash
git clone https://github.com/rogue-function/wog-mmorpg.git
cd wog-mmorpg

# Install server dependencies
cd shard && npm install

# Install client dependencies
cd ../client && npm install
```

### 2. Configure environment

```bash
# From project root
cp .env.example shard/.env
```

Edit `shard/.env` and fill in:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Claude API key |
| `AGENT_SEED_PHRASE` | Yes | 24-word mnemonic for agent wallets |
| `STACKS_NETWORK` | Yes | `testnet` or `mainnet` |
| `SERVER_PRIVATE_KEY` | Yes | Hex private key for the deployer wallet |
| `SERVER_STACKS_ADDRESS` | Yes | Stacks address of the deployer |
| `GOLD_CONTRACT_ADDRESS` | Yes | Address where wog-gold is deployed |
| `CHARACTER_CONTRACT_ADDRESS` | Yes | Address where character-nft is deployed |
| `ITEMS_CONTRACT_ADDRESS` | Yes | Address where wog-items is deployed |
| `SPRINT_CONTRACT_ADDRESS` | Yes | Address where wog-sprint is deployed |
| `X402_FACILITATOR_URL` | No | x402 facilitator (default: https://x402.org/facilitator) |
| `AGENT_COUNT` | No | Number of AI agents (default: 3, max: 5) |
| `PORT` | No | Server port (default: 3001) |
| `SPRINT_SUBMIT_INTERVAL` | No | Ticks between sprint score submissions (default: 20) |

### 3. Set up wallets (optional — blockchain features)

```bash
cd shard
npm run setup-wallets
# Outputs agent wallet addresses derived from AGENT_SEED_PHRASE
```

### 4. Deploy contracts (optional — blockchain features)

Deploy the 5 `.clar` files in `wog-contracts/contracts/` to Stacks testnet:
- Use [Hiro Platform](https://platform.hiro.so) or the Stacks CLI
- Copy deployed addresses into `shard/.env`

### 5. Mint character NFTs (optional — run once after deploying contracts)

```bash
cd shard
npm run mint
```

### 6. Run the game

```bash
# Terminal 1 — Game server (port 3001)
cd shard
npm run dev

# Terminal 2 — AI agents
cd shard
npm run agents

# Terminal 3 — Frontend (port 5173)
cd client
npm run dev
```

Open **http://localhost:5173** — you'll see the landing page. Click "Play Now" to enter the game.

### Or with Docker

```bash
# From project root — fill in .env first
docker compose up
# Frontend: http://localhost:80
# Server:   http://localhost:3000
```

---

## Deploying to Production

### Railway (Backend)

1. Create a new Railway project, link this repo
2. Set root directory to `shard`
3. Set start command: `node start.js`
4. Add all env vars from the table above
5. Set `PORT=8080` (Railway's default)

`start.js` launches both the game server and agent process in a single container with a process guard to prevent duplicate agent spawning.

### Vercel (Frontend)

1. Import the repo to Vercel
2. Set root directory to `client`
3. Build command: `npm run build`
4. Output directory: `dist`
5. Add environment variable:
   - `VITE_SHARD_URL` = your Railway backend URL (e.g., `https://rogue-function-production.up.railway.app`)

---

## Smart Contracts (Stacks Testnet)

All deployed from `ST9NSDHK5969YF6WJ2MRCVVAVTDENWBNTFJRVZ3E`:

| Contract | Standard | Description |
|----------|----------|-------------|
| `wog-gold` | SIP-010 | Fungible gold token — earned from combat and quests |
| `character-nft` | SIP-009 | Character NFTs with on-chain stats (class, level, XP) |
| `wog-items` | SIP-009 | Item NFTs (weapons, potions, armor) |
| `wog-sprint` | Custom | aibtc Sprint competition — create, register, submit scores, finalize |
| `leaderboard` | Custom | On-chain achievement records |

---

## How It Works

```
Every 30 seconds (one tick):

1. batchAgents.ts fetches world state via GET /state/batch
2. Claude Haiku 4.5 receives each agent's context (HP, zone, mobs, quests, inventory)
3. Claude returns a decision: attack, move, accept_quest, use_item, or rest
4. Server executes the action → combat rolls, quest progress, zone transitions
5. Results broadcast to all connected clients via WebSocket
6. Gold/XP earned → blockchain contract calls fire in background
7. Every 20 ticks → sprint scores submitted on-chain
```

---

## Zones & Mobs

| Zone | Levels | Mobs |
|------|--------|------|
| Human Meadow | 1-5 | Rat, Wolf, Boar, Goblin, Slime, Bandit |
| Wild Meadow | 5-10 | Bear, Spider, Orc, Harpy, Troll |
| Dark Forest | 10-16 | Shadow, Dark Knight, Necromancer |

20 quests across 3 chains. 5,375 total gold + 10,750 total XP in rewards.

---

## Sprites

Download free CC0 sprite sheets from [Kenney.nl](https://kenney.nl):
- [Roguelike RPG Pack](https://kenney.nl/assets/roguelike-rpg-pack) → `roguelikeRPG_transparent.png`
- [Roguelike Characters](https://kenney.nl/assets/roguelike-characters) → `roguelikeChar_transparent.png`

Place in:
```
client/public/assets/
├── characters/roguelikeChar_transparent.png
└── tiles/roguelikeRPG_transparent.png
```

Game works without them — colored shape fallbacks activate automatically. See `SPRITE_GUIDE.md` for details.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| AI Engine | Claude Haiku 4.5 (Anthropic API) |
| Blockchain | Stacks / Clarity smart contracts |
| Backend | Fastify + WebSocket (Node.js / TypeScript) |
| Frontend | Phaser 3 + Vite |
| Payments | x402 protocol (STX micropayments) |
| Hosting | Railway (backend) + Vercel (frontend) |

---

## Scripts Reference

Run from `shard/`:

| Script | Command | Description |
|--------|---------|-------------|
| Dev server | `npm run dev` | Start game server |
| Agents | `npm run agents` | Start AI agent loop |
| Setup wallets | `npm run setup-wallets` | Generate agent wallets from seed |
| Mint NFTs | `npm run mint` | Mint character NFTs on Stacks |
| Create sprint | `npm run sprint:create` | Create a new sprint competition on-chain |
| Tests | `npm test` | Run test suite (vitest) |

---

## License

MIT

---

Built for the **aibtc Sprint** | Powered by **Claude** | Settled on **Stacks**
