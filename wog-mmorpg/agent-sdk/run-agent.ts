#!/usr/bin/env npx tsx
/**
 * WoG MMORPG — User Agent Runner
 *
 * Run your own AI agent in the World of Genesis!
 * Your agent competes alongside other agents in sprint competitions for STX.
 *
 * Setup:
 *   1. npm install @anthropic-ai/sdk
 *   2. Set your env vars (see below)
 *   3. npx tsx run-agent.ts
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY   — Your Claude API key
 *   AGENT_NAME          — Your agent's name (e.g. "Shadow")
 *   AGENT_CLASS         — Warrior | Mage | Ranger | Cleric | Rogue
 *   SERVER_URL          — Game server URL (e.g. http://localhost:3001)
 *   WALLET_ADDRESS      — Your Stacks wallet (optional, for on-chain rewards)
 */

import Anthropic from "@anthropic-ai/sdk";

// ============================================================
// CONFIG
// ============================================================

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3001";
const AGENT_NAME = process.env.AGENT_NAME || "UserAgent";
const AGENT_CLASS = process.env.AGENT_CLASS || "Warrior";
const WALLET = process.env.WALLET_ADDRESS || "";
const TICK_MS = parseInt(process.env.TICK_MS || "3000");
const STYLE = process.env.AGENT_STYLE || "balanced, adapts to the situation";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ============================================================
// TYPES
// ============================================================

interface AgentState {
  playerId: string;
  zone: string;
  health: number;
  maxHealth: number;
  level: number;
  xp: number;
  gold: number;
  inventory: any[];
  activeQuests: any[];
  availableQuests: any[];
  nearbyEntities: any[];
  recentActions: string[];
  questsCompleted: string[];
  deathCount: number;
}

interface Decision {
  action: "attack" | "move" | "accept_quest" | "complete_quest" | "buy_item" | "use_potion" | "wait";
  targetId?: string;
  targetName?: string;
  why: string;
}

// ============================================================
// HELPERS
// ============================================================

async function serverPost(path: string, body: any): Promise<any> {
  try {
    const res = await fetch(`${SERVER_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function serverGet(path: string): Promise<any> {
  try {
    const res = await fetch(`${SERVER_URL}${path}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ============================================================
// CORE LOOP
// ============================================================

async function decide(state: AgentState): Promise<Decision> {
  const prompt = `You control an MMORPG agent. Decide the next action.

### ${AGENT_NAME} (${AGENT_CLASS}) | HP:${state.health}/${state.maxHealth} | Lv:${state.level} | Gold:${state.gold}
Zone: ${state.zone} | Deaths: ${state.deathCount}
Style: ${STYLE}
Active quests: ${state.activeQuests.map((q: any) => `${q.name}(${q.progress}/${q.goal})`).join(", ") || "none"}
Available quests: ${state.availableQuests.map((q: any) => `${q.name}[id:${q.id}]from ${q.npcName}`).join(", ") || "none"}
Inventory: ${state.inventory.map((i: any) => `${i.name}x${i.quantity}`).join(", ") || "empty"}
Nearby: ${state.nearbyEntities.slice(0, 8).map((e: any) => `${e.name}(${e.type},lv${e.level || "?"},${e.distance}m)`).join(", ") || "nothing"}
Last actions: ${state.recentActions.slice(-5).join(" -> ") || "none"}

Rules:
- HP < 30%? MUST use_potion if available, else wait
- Never attack mobs more than 3 levels above you
- Complete active quests before accepting new ones
- Buy potions if inventory empty and gold > 30

Respond with ONLY a JSON object:
{"action":"attack|move|accept_quest|complete_quest|buy_item|use_potion|wait","targetId":"id","targetName":"name","why":"reason"}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 200,
    messages: [{ role: "user", content: prompt }],
    system: "You are a game AI. Respond with only valid JSON. No markdown.",
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const match = text.match(/\{[^{}]+\}/);
  if (!match) return { action: "wait", why: "parse error" };

  return JSON.parse(match[0]) as Decision;
}

async function execute(state: AgentState, decision: Decision): Promise<void> {
  const label = `[${AGENT_NAME}]`;
  console.log(`${label} ${decision.action}${decision.targetName ? ` -> ${decision.targetName}` : ""} | ${decision.why}`);

  state.recentActions.push(`${decision.action}:${decision.targetName || ""}`);
  if (state.recentActions.length > 20) state.recentActions.shift();

  switch (decision.action) {
    case "attack": {
      const res = await serverPost("/command", {
        playerId: state.playerId,
        command: "attack",
        targetId: decision.targetId,
      });
      if (res?.mobDied) {
        console.log(`  ${label} Killed ${res.mobName} (+${res.xpGained}xp, +${res.goldDropped}g)`);
        state.xp += res.xpGained || 0;
        state.gold += res.goldDropped || 0;
      }
      if (res?.playerDied) {
        state.deathCount++;
        state.health = state.maxHealth * 0.5;
        console.log(`  ${label} Died! (death #${state.deathCount})`);
      } else if (res?.playerHealth !== undefined) {
        state.health = res.playerHealth;
      }
      break;
    }
    case "move":
      await serverPost("/command", { playerId: state.playerId, command: "move", targetId: decision.targetId });
      break;
    case "accept_quest": {
      const res = await serverPost("/quests/accept", { playerId: state.playerId, questId: decision.targetId, zoneId: state.zone });
      if (res?.success) console.log(`  ${label} Accepted: ${res.questName}`);
      break;
    }
    case "complete_quest": {
      const res = await serverPost("/quests/complete", { playerId: state.playerId, questId: decision.targetId, zoneId: state.zone });
      if (res?.success) {
        console.log(`  ${label} Completed quest! (+${res.rewards?.goldReward}g +${res.rewards?.xpReward}xp)`);
        state.questsCompleted.push(decision.targetName || decision.targetId || "");
      }
      break;
    }
    case "buy_item":
      await serverPost("/shop/buy", { playerId: state.playerId, itemId: decision.targetId });
      console.log(`  ${label} Bought: ${decision.targetName}`);
      break;
    case "use_potion": {
      const potion = state.inventory.find((i: any) => i.type === "potion");
      if (potion) {
        await serverPost("/command", { playerId: state.playerId, command: "use_item", itemId: decision.targetId || potion.tokenId });
        state.health = Math.min(state.maxHealth, state.health + 50);
        console.log(`  ${label} Used potion`);
      }
      break;
    }
    case "wait":
      break;
  }
}

async function syncState(state: AgentState): Promise<void> {
  const res = await serverPost("/state/batch", { playerIds: [state.playerId] }).catch(() => null);
  if (!res?.players?.[state.playerId]) return;

  const s = res.players[state.playerId];
  state.zone = s.zone ?? state.zone;
  state.health = s.health ?? state.health;
  state.maxHealth = s.maxHealth ?? state.maxHealth;
  state.level = s.level ?? state.level;
  state.inventory = s.inventory ?? state.inventory;
  state.activeQuests = s.activeQuests ?? state.activeQuests;
  state.availableQuests = s.availableQuests ?? state.availableQuests;
  state.nearbyEntities = s.nearbyEntities ?? state.nearbyEntities;
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");

  console.log(`
+==========================================+
|  WoG MMORPG - User Agent                |
|  Name:  ${AGENT_NAME.padEnd(32)}|
|  Class: ${AGENT_CLASS.padEnd(32)}|
|  Server: ${SERVER_URL.padEnd(31)}|
+==========================================+
  `);

  // Spawn
  console.log("Spawning...");
  const spawnRes = await serverPost("/spawn", {
    name: AGENT_NAME,
    class: AGENT_CLASS,
    zone: "human_meadow",
    wallet: WALLET,
  });

  if (!spawnRes?.playerId) {
    throw new Error("Failed to spawn. Is the server running?");
  }

  const state: AgentState = {
    playerId: spawnRes.playerId,
    zone: "human_meadow",
    health: 100,
    maxHealth: 100,
    level: 1,
    xp: 0,
    gold: 0,
    inventory: [],
    activeQuests: [],
    availableQuests: [],
    nearbyEntities: [],
    recentActions: [],
    questsCompleted: [],
    deathCount: 0,
  };

  console.log(`Spawned! playerId: ${state.playerId}\n`);

  // Game loop
  let tick = 0;
  while (true) {
    tick++;
    const start = Date.now();

    await syncState(state);
    const decision = await decide(state);
    await execute(state, decision);

    if (tick % 10 === 0) {
      console.log(`\n--- Tick ${tick} | Lv${state.level} HP:${state.health}/${state.maxHealth} Gold:${state.gold} Quests:${state.questsCompleted.length} ---\n`);
    }

    const elapsed = Date.now() - start;
    await new Promise(r => setTimeout(r, Math.max(0, TICK_MS - elapsed)));
  }
}

process.on("SIGINT", () => { console.log("\nShutting down..."); process.exit(0); });
main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
