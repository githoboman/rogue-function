/**
 * server.ts — WoG MMORPG Shard Server
 * Fastify HTTP + WebSocket server
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import rateLimit from "@fastify/rate-limit";
import { ZoneRuntime } from "./zoneRuntime";
import { NPCS, ITEM_TEMPLATES } from "./worldData";
import { broadcaster } from "./wsEvents";
import { mintGold, awardXP } from "./blockchain";
import { updateLeaderboard } from "./leaderboard";
import { submitScores } from "./aibtcSprint";
import type { AgentState } from "./batchAgents";
import { isAIPaused, setAIPaused } from "./batchAgents";
import { x402Pay, getPaymentInfo, FACILITATOR_URL } from "./x402";
import { GameConfig } from "./config";
import { loadGameState, startAutoSave } from "./persistence";
import { startHeartbeat } from "./aibtcHeartbeat";

// ============================================================
// INIT
// ============================================================

const server = Fastify({ logger: false });
const runtime = new ZoneRuntime();

server.register(cors, { origin: "*" });
server.register(websocket);
server.register(rateLimit, {
  max: GameConfig.RATE_LIMIT_MAX,
  timeWindow: GameConfig.RATE_LIMIT_WINDOW_MS,
  allowList: ["127.0.0.1", "::1"],  // localhost exempt (internal agent calls)
});

// Restore saved game state if available
const savedState = loadGameState();
if (savedState) {
  for (const p of savedState.players) {
    runtime.spawnPlayer({
      id: p.id, name: p.name, class: p.class, race: p.race,
      zone: p.zone, wallet: p.wallet, characterTokenId: p.characterTokenId,
    });
    const player = runtime.players.get(p.id);
    if (player) {
      player.level = p.level; player.xp = p.xp;
      player.currentHp = p.currentHp; player.maxHp = p.maxHp;
      player.gold = p.gold; player.position = { ...p.position };
      player.inventory = p.inventory;
      player.equippedAttackBonus = p.equippedAttackBonus;
      player.equippedDefenseBonus = p.equippedDefenseBonus;
    }
  }
  console.log(`📂 Restored ${savedState.players.length} players from save`);
}

// Auto-save game state periodically
startAutoSave(runtime.players, runtime.questManager);

// Patch runtime to emit level-up events
const origAttack = runtime.handleAttack.bind(runtime);
runtime.handleAttack = (playerId: string, targetMobId: string) => {
  const prevLevel = runtime.players.get(playerId)?.level || 1;
  const result = origAttack(playerId, targetMobId);
  const player = runtime.players.get(playerId);
  if (player && player.level > prevLevel) {
    broadcaster.emit({ type: "player_levelup", data: { playerId, playerName: player.name, newLevel: player.level, zone: player.zone } });
  }
  return result;
};

// Start 1s game tick, snapshot to broadcaster each tick
runtime.startTickLoop(GameConfig.TICK_INTERVAL_MS, (snapshot: any) => broadcaster.tick(snapshot));

console.log(`
╔══════════════════════════════════════════════╗
║         WoG MMORPG — Shard Server            ║
╠══════════════════════════════════════════════╣
║  HTTP  : REST API for agents & frontend      ║
║  WS    : ws://localhost:3000/ws              ║
╚══════════════════════════════════════════════╝
`);

// ============================================================
// WEBSOCKET
// ============================================================

server.register(async (fastify) => {
  fastify.get("/ws", { websocket: true }, (socket) => {
    broadcaster.addClient(socket as any);
  });
});

// ============================================================
// HEALTH
// ============================================================

server.get("/health", async () => ({
  status: "ok",
  uptime: Math.floor(process.uptime()),
  spectators: broadcaster.spectatorCount,
  aiPaused: isAIPaused(),
  world: runtime.getFullWorldSnapshot(),
}));

// AI pause/resume toggle
server.post("/ai/pause", async () => { setAIPaused(true); return { aiPaused: true, message: "AI paused — agents using fallback AI" }; });
server.post("/ai/resume", async () => { setAIPaused(false); return { aiPaused: false, message: "AI resumed — agents using Claude API" }; });
server.get("/ai/status", async () => ({ aiPaused: isAIPaused() }));

// ============================================================
// SPAWN
// ============================================================

server.post<{
  Body: { agentId?: string; name: string; class: string; race?: string; zone?: string; wallet?: string; characterTokenId?: number };
}>("/spawn", async (req) => {
  const b = req.body as any;
  const playerId = b.agentId || b.wallet || `player_${Date.now()}`;

  if (runtime.players.has(playerId)) {
    const p = runtime.players.get(playerId)!;
    return { success: true, playerId, characterTokenId: p.characterTokenId, alreadySpawned: true };
  }

  const player = runtime.spawnPlayer({
    id: playerId, name: b.name || "Adventurer", class: b.class || "Warrior",
    race: b.race || "Human", zone: b.zone || "human_meadow",
    wallet: b.wallet || "", characterTokenId: b.characterTokenId || 0,
  });

  broadcaster.emit({ type: "agent_decision", data: { playerId: player.id, playerName: player.name, action: "spawned", target: player.zone, reasoning: `${player.name} the ${player.class} enters the world` } });
  return { success: true, playerId: player.id, characterTokenId: player.characterTokenId, spawnPoint: player.position, zone: player.zone };
});

// ============================================================
// x402 PAYMENT INFO
// ============================================================

server.get("/x402/info", async () => ({
  enabled: true,
  network: process.env.STACKS_NETWORK || "testnet",
  payTo: process.env.SERVER_STACKS_ADDRESS,
  facilitator: FACILITATOR_URL,
  paidEndpoints: {
    "GET  /x402/world":        { amountSTX: "0.001",  description: "Full world snapshot — all zones, players, mobs" },
    "GET  /x402/leaderboard":  { amountSTX: "0.001",  description: "Agent rankings and scores" },
    "GET  /x402/agent/:id":    { amountSTX: "0.0005", description: "Detailed agent stats, inventory, quest history" },
    "POST /agent/register":    { amountSTX: "0.01",   description: "Register your own AI agent in the game world" },
  },
  externalAgentAPI: "GET /agent/info for full docs",
}));

// ============================================================
// x402 PAID DATA API — external consumers pay STX to query
// ============================================================

/** Full world snapshot — spectators, dashboards, third-party apps */
server.get("/x402/world", {
  preHandler: x402Pay({ amountSTX: "0.001", description: "Full world snapshot" }),
}, async (req) => {
  const payment = getPaymentInfo(req);
  const snapshot = runtime.getFullWorldSnapshot();
  return {
    ...snapshot,
    x402: payment ? { payer: payment.payer, tx: payment.transaction } : undefined,
  };
});

/** Agent leaderboard — rankings by level, gold, kills, quests */
server.get("/x402/leaderboard", {
  preHandler: x402Pay({ amountSTX: "0.001", description: "Agent leaderboard" }),
}, async (req) => {
  const payment = getPaymentInfo(req);
  const players = Array.from(runtime.players.values()).map(p => ({
    id: p.id, name: p.name, class: p.class, level: p.level,
    gold: p.gold, zone: p.zone, health: p.currentHp, maxHealth: p.maxHp,
    questsCompleted: runtime.questManager.getCompletedCount(p.id),
  }));
  players.sort((a, b) => b.level - a.level || b.gold - a.gold);
  return {
    leaderboard: players,
    totalPlayers: players.length,
    x402: payment ? { payer: payment.payer, tx: payment.transaction } : undefined,
  };
});

/** Detailed agent stats — inventory, quest log, combat history */
server.get<{ Params: { agentId: string } }>("/x402/agent/:agentId", {
  preHandler: x402Pay({ amountSTX: "0.0005", description: "Detailed agent stats" }),
}, async (req, reply) => {
  const player = runtime.players.get(req.params.agentId);
  if (!player) return reply.status(404).send({ error: "Agent not found" });
  const payment = getPaymentInfo(req);
  return {
    id: player.id, name: player.name, class: player.class, race: player.race,
    level: player.level, xp: player.xp, gold: player.gold,
    health: player.currentHp, maxHealth: player.maxHp,
    attack: player.equippedAttackBonus, defense: player.equippedDefenseBonus,
    zone: player.zone, position: player.position,
    wallet: player.wallet, characterTokenId: player.characterTokenId,
    inventory: player.inventory,
    activeQuests: runtime.questManager.getActiveQuests(player.id),
    questsCompleted: runtime.questManager.getCompletedCount(player.id),
    x402: payment ? { payer: payment.payer, tx: payment.transaction } : undefined,
  };
});

// ============================================================
// GAME STATE (free — used by AI agents every tick)
// ============================================================

server.get<{ Querystring: { playerId: string } }>("/state", async (req, reply) => {
  const state = runtime.getPlayerState(req.query.playerId);
  return state || reply.status(404).send({ error: "Player not found" });
});

server.post<{ Body: { playerIds: string[] } }>("/state/batch", async (req, reply) => {
  if (!req.body.playerIds?.length) return reply.status(400).send({ error: "playerIds required" });
  return { players: runtime.getBatchState(req.body.playerIds) };
});

// ============================================================
// COMMANDS
// ============================================================

server.post<{
  Body: { playerId: string; command: string; targetId?: string; itemTokenId?: number };
}>("/command", async (req, reply) => {
  const { playerId, command, targetId, itemTokenId } = req.body;
  const player = runtime.players.get(playerId);
  if (!player) return reply.status(404).send({ error: "Player not found" });

  switch (command) {
    case "attack": {
      if (!targetId) return reply.status(400).send({ error: "targetId required" });
      const result = runtime.handleAttack(playerId, targetId);
      if (result.error) {
        console.log(`⚔️  Attack failed: ${player.name} → ${targetId}: ${result.error}`);
        return reply.status(400).send(result);
      }
      console.log(`⚔️  ${player.name} hit ${result.mobName} for ${result.playerDamageDealt}dmg${result.mobDied ? " (KILLED!)" : ""} [hp:${result.mobHealth}]`);

      broadcaster.emit({ type: "combat_hit", data: { playerId, playerName: player.name, mobId: targetId, mobName: result.mobName, damage: result.playerDamageDealt, crit: result.playerCrit, mobHp: result.mobHealth, mobMaxHp: 0 } });
      if (result.mobDied) {
        broadcaster.emit({ type: "mob_died", data: { mobId: targetId, mobName: result.mobName, zone: player.zone, xpGained: result.xpGained, goldDropped: result.goldDropped, loot: result.loot.map((l: any) => l.itemName) } });
        // Mint rewards on-chain to the player's wallet (works for both AI agents and human players)
        const wallet = player.wallet;
        if (wallet && result.xpGained > 0 && player.characterTokenId > 0) {
          awardXP(player.characterTokenId, result.xpGained).catch(e => console.warn(`XP mint failed: ${e.message}`));
        }
        if (wallet && result.goldDropped > 0) {
          mintGold(wallet, result.goldDropped * 1_000_000).catch(e => console.warn(`Gold mint failed: ${e.message}`));
        }
      }
      if (result.playerDied) broadcaster.emit({ type: "player_died", data: { playerId, playerName: player.name, zone: player.zone, deathCount: 0 } });
      return result;
    }

    case "move": {
      if (!targetId) return reply.status(400).send({ error: "targetId required" });
      const result = runtime.handleMove(playerId, targetId);
      if (result.zoneTransition) broadcaster.emit({ type: "zone_transition", data: { playerId, playerName: player.name, fromZone: player.zone, toZone: result.zoneTransition } });
      return result;
    }

    case "interact": {
      if (!targetId) return reply.status(400).send({ error: "targetId required" });
      const npc = NPCS[targetId];
      if (!npc) return reply.status(404).send({ error: "NPC not found" });
      const availableQuests = runtime.questManager.getAvailableQuests(player, npc.zone, npc.id)
        .map(q => ({ id: q.id, name: q.name, description: q.description, objective: q.objective, goldReward: q.goldReward, xpReward: q.xpReward }));
      return { npcId: npc.id, npcName: npc.name, role: npc.role, dialogue: npc.dialogue, availableQuests, shopInventory: npc.shopInventory?.map(id => ITEM_TEMPLATES[id]) || [] };
    }

    case "use_item": {
      if (!itemTokenId) return reply.status(400).send({ error: "itemTokenId required" });
      return runtime.handleUseItem(playerId, itemTokenId);
    }

    default:
      return reply.status(400).send({ error: `Unknown command: ${command}` });
  }
});

// ============================================================
// QUESTS
// ============================================================

server.get<{ Params: { zoneId: string; npcId: string }; Querystring: { playerId: string } }>(
  "/quests/:zoneId/:npcId", async (req, reply) => {
    const player = runtime.players.get(req.query.playerId);
    if (!player) return reply.status(404).send({ error: "Player not found" });
    return { available: runtime.questManager.getAvailableQuests(player, req.params.zoneId, req.params.npcId), active: runtime.questManager.getActiveQuests(req.query.playerId) };
  }
);

server.post<{ Body: { playerId: string; questId: string } }>("/quests/accept", async (req, reply) => {
  const { playerId, questId } = req.body;
  const player = runtime.players.get(playerId);
  if (!player) return reply.status(404).send({ error: "Player not found" });
  const result = runtime.questManager.acceptQuest(playerId, questId);
  if (result.success) broadcaster.emit({ type: "quest_accepted", data: { playerId, playerName: player.name, questName: result.questName! } });
  return result;
});

server.post<{ Body: { playerId: string; questId: string } }>("/quests/complete", async (req, reply) => {
  const { playerId, questId } = req.body;
  const player = runtime.players.get(playerId);
  if (!player) return reply.status(404).send({ error: "Player not found" });
  const result = runtime.questManager.completeQuest(playerId, questId);
  if (result.success && result.rewards) {
    player.xp += result.rewards.xpReward;
    player.gold += result.rewards.goldReward;
    for (const id of result.rewards.itemRewards) runtime.addToInventory(player, id, 1);
    broadcaster.emit({ type: "quest_completed", data: { playerId, playerName: player.name, questName: questId, goldReward: result.rewards.goldReward, xpReward: result.rewards.xpReward } });
    // Mint quest rewards on-chain to the player's wallet
    const wallet = player.wallet;
    if (wallet && result.rewards.goldReward > 0) {
      mintGold(wallet, result.rewards.goldReward * 1_000_000).catch(e => console.warn(`Quest gold mint failed: ${e.message}`));
    }
    if (wallet && result.rewards.xpReward > 0 && player.characterTokenId > 0) {
      awardXP(player.characterTokenId, result.rewards.xpReward).catch(e => console.warn(`Quest XP mint failed: ${e.message}`));
    }
  }
  return result;
});

server.get<{ Params: { zoneId: string; playerId: string } }>(
  "/quests/active/:zoneId/:playerId", async (req) => runtime.questManager.getActiveQuests(req.params.playerId)
);

// ============================================================
// SHOP
// ============================================================

server.get("/shop/catalog", async () => ({
  items: Object.values(ITEM_TEMPLATES).map(t => ({ id: String(t.id), templateId: t.id, name: t.name, type: t.type, rarity: t.rarity, levelReq: t.levelReq, goldCost: t.goldValue, stats: { attack: t.attackBonus, defense: t.defenseBonus, hpRestore: t.hpRestore } })),
}));

server.get<{ Params: { zoneId: string; npcId: string } }>("/shop/npc/:zoneId/:npcId", async (req, reply) => {
  const npc = NPCS[req.params.npcId];
  if (!npc || npc.role !== "merchant") return reply.status(404).send({ error: "Merchant not found" });
  return { npcId: npc.id, npcName: npc.name, inventory: (npc.shopInventory || []).map(id => ITEM_TEMPLATES[id]).filter(Boolean) };
});

server.post<{ Body: { playerId: string; itemId: string; quantity?: number } }>("/shop/buy", async (req, reply) => {
  const { playerId, itemId } = req.body;
  const player = runtime.players.get(playerId);
  if (!player) return reply.status(404).send({ error: "Player not found" });
  const template = ITEM_TEMPLATES[parseInt(itemId)];
  if (!template) return reply.status(404).send({ error: "Item not found" });
  const qty = req.body.quantity || 1;
  const totalCost = template.goldValue * qty;
  if (player.gold < totalCost) return reply.status(400).send({ error: "Not enough gold", needed: totalCost, have: player.gold });
  player.gold -= totalCost;
  runtime.addToInventory(player, template.id, qty);
  return { success: true, itemName: template.name, quantity: qty, goldSpent: totalCost, gold: player.gold };
});

// ============================================================
// EXTERNAL AGENT API — bring your own agent
// ============================================================

// Registry: playerId → agent metadata + API key
const externalAgents = new Map<string, {
  apiKey: string;
  wallet: string;
  name: string;
  class: string;
  registeredAt: number;
  lastAction: number;
  actionsThisTick: number;
}>();

function generateApiKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "wog_";
  for (let i = 0; i < 32; i++) key += chars[Math.floor(Math.random() * chars.length)];
  return key;
}

const MAX_ACTIONS_PER_TICK = 3;
const TICK_WINDOW_MS = 3000;

function requireAgentAuth(req: any, reply: any): { playerId: string } | null {
  const apiKey = req.headers["x-agent-key"] as string;
  if (!apiKey) { reply.status(401).send({ error: "Missing x-agent-key header" }); return null; }
  const entry = [...externalAgents.entries()].find(([, v]) => v.apiKey === apiKey);
  if (!entry) { reply.status(401).send({ error: "Invalid API key" }); return null; }
  const [playerId, agent] = entry;
  const now = Date.now();
  if (now - agent.lastAction > TICK_WINDOW_MS) agent.actionsThisTick = 0;
  if (agent.actionsThisTick >= MAX_ACTIONS_PER_TICK) {
    reply.status(429).send({ error: "Rate limited — max 3 actions per 3s tick" }); return null;
  }
  agent.actionsThisTick++;
  agent.lastAction = now;
  return { playerId };
}

/** GET /agent/info — public docs for external agent API */
server.get("/agent/info", async () => ({
  description: "Bring Your Own Agent — connect your AI to World of Genesis",
  flow: [
    "1. POST /agent/register (x402: 0.01 STX) → get apiKey + playerId",
    "2. GET  /agent/state (x-agent-key header) → get your game state each tick",
    "3. POST /agent/action (x-agent-key header) → submit actions",
    "4. Repeat 2-3 every ~3s. Your agent competes alongside built-in AI agents.",
  ],
  actions: ["attack", "move", "accept_quest", "complete_quest", "buy_item", "use_potion", "interact", "wait"],
  registration: {
    endpoint: "POST /agent/register",
    cost: "0.01 STX (x402)",
    body: { name: "string (max 20 chars)", class: "Warrior|Mage|Ranger|Cleric|Rogue|Paladin|Necromancer|Druid", wallet: "STX address (optional, for on-chain rewards)" },
  },
  limits: { actionsPerTick: MAX_ACTIONS_PER_TICK, tickWindow: `${TICK_WINDOW_MS}ms` },
  currentPlayers: runtime.players.size,
  externalAgents: externalAgents.size,
}));

/** POST /agent/register — x402 gated, spawns agent, returns API key */
server.post<{
  Body: { name: string; class: string; wallet?: string; zone?: string };
}>("/agent/register", {
  preHandler: x402Pay({ amountSTX: "0.01", description: "Register external agent in World of Genesis" }),
}, async (req, reply) => {
  const b = req.body;
  if (!b.name || !b.class) return reply.status(400).send({ error: "name and class required" });

  const validClasses = ["Warrior", "Mage", "Ranger", "Cleric", "Rogue", "Paladin", "Necromancer", "Druid"];
  if (!validClasses.includes(b.class)) return reply.status(400).send({ error: `Invalid class. Choose: ${validClasses.join(", ")}` });

  const name = b.name.slice(0, 20);
  const nameTaken = [...runtime.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase());
  if (nameTaken) return reply.status(409).send({ error: `Name "${name}" is already taken` });

  const apiKey = generateApiKey();
  const playerId = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const player = runtime.spawnPlayer({
    id: playerId, name, class: b.class,
    race: "Human", zone: b.zone || "human_meadow",
    wallet: b.wallet || "", characterTokenId: 0,
  });

  externalAgents.set(playerId, {
    apiKey, wallet: b.wallet || "", name, class: b.class,
    registeredAt: Date.now(), lastAction: 0, actionsThisTick: 0,
  });

  const payment = getPaymentInfo(req);
  console.log(`🤖 External agent registered: ${name} (${b.class}) — playerId: ${playerId}${payment ? ` — paid by ${payment.payer}` : ""}`);
  broadcaster.emit({ type: "agent_decision", data: { playerId, playerName: name, action: "spawned", target: player.zone, reasoning: `External agent ${name} the ${b.class} enters the world` } });

  return {
    success: true, playerId, apiKey, name, class: b.class,
    zone: player.zone, spawnPoint: player.position,
    usage: {
      stateEndpoint: "GET /agent/state",
      actionEndpoint: "POST /agent/action",
      header: "x-agent-key: " + apiKey,
    },
  };
});

/** GET /agent/state — full game state for your agent (auth required) */
server.get("/agent/state", async (req, reply) => {
  const auth = requireAgentAuth(req, reply);
  if (!auth) return;
  const state = runtime.getPlayerState(auth.playerId);
  if (!state) return reply.status(404).send({ error: "Agent not found — may have been removed" });
  return state;
});

/** POST /agent/action — submit a game action (auth required) */
server.post<{
  Body: { action: string; targetId?: string; itemId?: string };
}>("/agent/action", async (req, reply) => {
  const auth = requireAgentAuth(req, reply);
  if (!auth) return;
  const { action, targetId, itemId } = req.body;
  const player = runtime.players.get(auth.playerId);
  if (!player) return reply.status(404).send({ error: "Agent not found" });

  const agentInfo = externalAgents.get(auth.playerId);
  console.log(`🤖 [${agentInfo?.name || auth.playerId}] ${action}${targetId ? ` → ${targetId}` : ""}`);

  switch (action) {
    case "attack": {
      if (!targetId) return reply.status(400).send({ error: "targetId required (mob id)" });
      const result = runtime.handleAttack(auth.playerId, targetId);
      if (result.error) return reply.status(400).send(result);
      broadcaster.emit({ type: "combat_hit", data: { playerId: auth.playerId, playerName: player.name, mobId: targetId, mobName: result.mobName, damage: result.playerDamageDealt, crit: result.playerCrit, mobHp: result.mobHealth, mobMaxHp: 0 } });
      if (result.mobDied) {
        broadcaster.emit({ type: "mob_died", data: { mobId: targetId, mobName: result.mobName, zone: player.zone, xpGained: result.xpGained, goldDropped: result.goldDropped, loot: result.loot.map((l: any) => l.itemName) } });
        if (player.wallet && result.xpGained > 0 && player.characterTokenId > 0) awardXP(player.characterTokenId, result.xpGained).catch(() => {});
        if (player.wallet && result.goldDropped > 0) mintGold(player.wallet, result.goldDropped * 1_000_000).catch(() => {});
      }
      if (result.playerDied) broadcaster.emit({ type: "player_died", data: { playerId: auth.playerId, playerName: player.name, zone: player.zone, deathCount: 0 } });
      return result;
    }

    case "move": {
      if (!targetId) return reply.status(400).send({ error: "targetId required (zone or position)" });
      const result = runtime.handleMove(auth.playerId, targetId);
      if (result.zoneTransition) broadcaster.emit({ type: "zone_transition", data: { playerId: auth.playerId, playerName: player.name, fromZone: player.zone, toZone: result.zoneTransition } });
      return result;
    }

    case "accept_quest": {
      if (!targetId) return reply.status(400).send({ error: "targetId required (questId)" });
      const result = runtime.questManager.acceptQuest(auth.playerId, targetId);
      if (result.success) broadcaster.emit({ type: "quest_accepted", data: { playerId: auth.playerId, playerName: player.name, questName: result.questName! } });
      return result;
    }

    case "complete_quest": {
      if (!targetId) return reply.status(400).send({ error: "targetId required (questId)" });
      const result = runtime.questManager.completeQuest(auth.playerId, targetId);
      if (result.success && result.rewards) {
        player.xp += result.rewards.xpReward;
        player.gold += result.rewards.goldReward;
        for (const id of result.rewards.itemRewards) runtime.addToInventory(player, id, 1);
        broadcaster.emit({ type: "quest_completed", data: { playerId: auth.playerId, playerName: player.name, questName: targetId, goldReward: result.rewards.goldReward, xpReward: result.rewards.xpReward } });
        if (player.wallet && result.rewards.goldReward > 0) mintGold(player.wallet, result.rewards.goldReward * 1_000_000).catch(() => {});
        if (player.wallet && result.rewards.xpReward > 0 && player.characterTokenId > 0) awardXP(player.characterTokenId, result.rewards.xpReward).catch(() => {});
      }
      return result;
    }

    case "buy_item": {
      const id = itemId || targetId;
      if (!id) return reply.status(400).send({ error: "itemId or targetId required (numeric template ID, e.g. '20' for health potion)" });
      const template = ITEM_TEMPLATES[parseInt(id)];
      if (!template) return reply.status(404).send({ error: "Item not found. GET /shop/catalog for available items" });
      if (player.gold < template.goldValue) return reply.status(400).send({ error: "Not enough gold", needed: template.goldValue, have: player.gold });
      player.gold -= template.goldValue;
      runtime.addToInventory(player, template.id, 1);
      return { success: true, itemName: template.name, goldSpent: template.goldValue, gold: player.gold };
    }

    case "use_potion": {
      const potion = player.inventory.find(i => ITEM_TEMPLATES[i.templateId]?.hpRestore > 0);
      if (!potion) return reply.status(400).send({ error: "No potions in inventory" });
      return runtime.handleUseItem(auth.playerId, potion.tokenId);
    }

    case "interact": {
      if (!targetId) return reply.status(400).send({ error: "targetId required (npcId)" });
      const npc = NPCS[targetId];
      if (!npc) return reply.status(404).send({ error: "NPC not found" });
      const availableQuests = runtime.questManager.getAvailableQuests(player, npc.zone, npc.id)
        .map(q => ({ id: q.id, name: q.name, description: q.description, objective: q.objective, goldReward: q.goldReward, xpReward: q.xpReward }));
      return { npcId: npc.id, npcName: npc.name, role: npc.role, dialogue: npc.dialogue, availableQuests, shopInventory: npc.shopInventory?.map(id => ITEM_TEMPLATES[id]) || [] };
    }

    case "wait":
      return { success: true, action: "wait" };

    default:
      return reply.status(400).send({ error: `Unknown action: ${action}. Valid: attack, move, accept_quest, complete_quest, buy_item, use_potion, interact, wait` });
  }
});

/** GET /agent/list — all external agents currently in the world */
server.get("/agent/list", async () => {
  const agents = [...externalAgents.entries()].map(([playerId, info]) => {
    const player = runtime.players.get(playerId);
    return {
      playerId, name: info.name, class: info.class,
      level: player?.level || 1, zone: player?.zone || "unknown",
      health: player?.currentHp || 0, maxHealth: player?.maxHp || 0,
      gold: player?.gold || 0, registeredAt: info.registeredAt,
    };
  });
  return { agents, count: agents.length };
});

// ============================================================
// HUMAN PLAYER AI PROXY — keys stay server-side, not in browser
// ============================================================

import Anthropic from "@anthropic-ai/sdk";

// playerId → { apiKey, lastAction, recentActions, running }
const playerAIKeys = new Map<string, { apiKey: string; lastAction: string; recentActions: string[]; running: boolean }>();

/** Register an API key for server-side AI decisions */
server.post<{ Body: { playerId: string; apiKey: string } }>("/player/register-ai", async (req, reply) => {
  const { playerId, apiKey } = req.body;
  if (!playerId || !apiKey) return reply.status(400).send({ error: "playerId and apiKey required" });
  const player = runtime.players.get(playerId);
  if (!player) return reply.status(404).send({ error: "Player not found — spawn first" });

  playerAIKeys.set(playerId, { apiKey, lastAction: "", recentActions: [], running: false });
  runPlayerAILoop(playerId);
  return { success: true };
});

/** Check latest AI action for a human player */
server.get<{ Querystring: { playerId: string } }>("/player/ai-status", async (req, reply) => {
  const entry = playerAIKeys.get(req.query.playerId);
  if (!entry) return reply.status(404).send({ error: "No AI registered" });
  return { lastAction: entry.lastAction, running: entry.running };
});

async function runPlayerAILoop(playerId: string): Promise<void> {
  const entry = playerAIKeys.get(playerId);
  if (!entry || entry.running) return;
  entry.running = true;

  const anthropic = new Anthropic({ apiKey: entry.apiKey });

  while (playerAIKeys.has(playerId)) {
    const player = runtime.players.get(playerId);
    if (!player) break;
    const state = runtime.getPlayerState(playerId);
    if (!state) break;

    try {
      const prompt = `You control an MMORPG agent. Decide the next action.
### ${player.name} (${player.class}) | HP:${state.health}/${state.maxHealth} | Lv:${state.level} | Gold:${state.gold}
Zone: ${state.zone}
Active quests: ${state.activeQuests.map((q: any) => `${q.name}[id:${q.id}](${q.progress}/${q.goal}${q.completed ? ",READY" : ""})`).join(", ") || "none"}
Available quests: ${state.availableQuests.map((q: any) => `${q.name}[id:${q.id}]from ${q.npcName}`).join(", ") || "none"}
Inventory: ${state.inventory.map((i: any) => `${i.name}x${i.quantity}`).join(", ") || "empty"}
Nearby: ${state.nearbyEntities.slice(0, 6).map((e: any) => `${e.name}[id:${e.id}](${e.type},lv${e.level||"?"},${e.distance}m)`).join(", ") || "nothing"}
Last actions: ${entry.recentActions.slice(-5).join(" -> ") || "none"}

Rules: HP < 30% use_potion or wait. Never attack mobs 3+ levels above. Complete quests before accepting new ones.
CRITICAL: targetId MUST be the exact id from [id:xxx] brackets.
Respond with ONLY JSON: {"action":"attack|move|accept_quest|complete_quest|buy_item|use_potion|wait","targetId":"exact_id","targetName":"name","why":"reason"}`;

      const aiRes = await anthropic.messages.create({
        model: "claude-sonnet-4-5", max_tokens: 200,
        system: "You are a game AI. Respond with only valid JSON. No markdown.",
        messages: [{ role: "user", content: prompt }],
      });

      const text = (aiRes.content[0] as any)?.text || "";
      const match = text.match(/\{[^{}]+\}/);
      if (match) {
        const d = JSON.parse(match[0]);
        entry.recentActions.push(`${d.action}:${d.targetName || ""}`);
        if (entry.recentActions.length > 20) entry.recentActions.shift();
        entry.lastAction = `${d.action} ${d.targetName || ""} — ${d.why}`;

        if (d.action === "accept_quest") {
          runtime.questManager.acceptQuest(playerId, d.targetId);
        } else if (d.action === "complete_quest") {
          const r = runtime.questManager.completeQuest(playerId, d.targetId);
          if (r.success && r.rewards) {
            player.xp += r.rewards.xpReward; player.gold += r.rewards.goldReward;
            for (const id of r.rewards.itemRewards) runtime.addToInventory(player, id, 1);
          }
        } else if (d.action === "buy_item") {
          const t = ITEM_TEMPLATES[parseInt(d.targetId)];
          if (t && player.gold >= t.goldValue) { player.gold -= t.goldValue; runtime.addToInventory(player, t.id, 1); }
        } else if (d.action === "use_potion") {
          const p = player.inventory.find(i => ITEM_TEMPLATES[i.templateId]?.hpRestore > 0);
          if (p) runtime.handleUseItem(playerId, p.tokenId);
        } else if (d.action === "attack" && d.targetId) {
          runtime.handleAttack(playerId, d.targetId);
        } else if (d.action === "move" && d.targetId) {
          runtime.handleMove(playerId, d.targetId);
        }

        broadcaster.emit({ type: "agent_decision", data: { playerId, playerName: player.name, action: d.action, target: d.targetName || d.targetId || "", reasoning: d.why } });
      }
    } catch (err: any) {
      console.warn(`Player AI error (${playerId}):`, err.message);
      if (err.status === 401) { entry.lastAction = "Error: invalid API key"; playerAIKeys.delete(playerId); break; }
    }

    await new Promise(r => setTimeout(r, 3500));
  }

  if (playerAIKeys.has(playerId)) playerAIKeys.get(playerId)!.running = false;
}

// ============================================================
// BLOCKCHAIN PROXY — all TXs go through THIS process's txQueue
// ============================================================

server.post<{ Body: { agents: AgentState[] } }>("/blockchain/submit-scores", async (req) => {
  const { agents } = req.body;
  if (!agents?.length) return { success: false, error: "agents required" };
  try {
    await submitScores(agents);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

server.post<{ Body: { agent: AgentState } }>("/blockchain/update-leaderboard", async (req) => {
  const { agent } = req.body;
  if (!agent) return { success: false, error: "agent required" };
  try {
    await updateLeaderboard(agent);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

// ============================================================
// START
// ============================================================

server.listen({ port: parseInt(process.env.PORT || "3000"), host: "0.0.0.0" }, (err, address) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(`🚀 HTTP:      ${address}`);
  console.log(`📡 WebSocket: ws://localhost:${process.env.PORT || 3000}/ws\n`);
  startHeartbeat();
});

export { server, runtime };
