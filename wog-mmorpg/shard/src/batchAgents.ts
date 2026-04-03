/**
 * batchAgents.ts — Zero-Latency Batched Agent System
 *
 * Architecture:
 *  - ONE Claude API call per tick for ALL agents simultaneously
 *  - Streaming so agents start acting as tokens arrive
 *  - Pure in-memory state — no DB reads per tick
 *  - Parallel execution — all agents act at the same time
 *  - One ANTHROPIC_API_KEY + one SERVER_PRIVATE_KEY
 *
 * Usage:
 *   pnpm exec tsx src/batchAgents.ts
 *   AGENT_COUNT=5 pnpm exec tsx src/batchAgents.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import { printStandings, SPRINT_SUBMIT_INTERVAL } from "./aibtcSprint";

// ============================================================
// CONFIG
// ============================================================

const TICK_MS = 30000;          // How often agents act (ms) — 30s to stay well within rate limits
const SERVER_URL = process.env.SHARD_SERVER_URL || `http://127.0.0.1:${process.env.PORT || "3000"}`;
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// AI pause toggle — controllable via env var or runtime API
let aiPaused = (process.env.AI_PAUSED || "false").toLowerCase() === "true";
export function setAIPaused(paused: boolean) { aiPaused = paused; }
export function isAIPaused() { return aiPaused; }

// Load character token IDs minted by spawnCharacterNFT.ts
function loadCharacterTokenIds(): Record<string, number> {
  const filePath = path.join(__dirname, "../agent-characters.json");
  if (fs.existsSync(filePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const ids: Record<string, number> = {};
      for (const [key, val] of Object.entries(raw)) {
        // Handle both { "agent-0": 1 } and { "agent-0": { characterTokenId: 1, ... } }
        ids[key] = typeof val === "number" ? val : (val as any)?.characterTokenId ?? 0;
      }
      console.log(`✅ Loaded character token IDs:`, ids);
      return ids;
    } catch (e) {
      console.warn("⚠️  Could not parse agent-characters.json — using token ID 0");
    }
  } else {
    console.warn("⚠️  agent-characters.json not found. Run `pnpm mint` first for on-chain characters.");
  }
  return {};
}

const CHARACTER_TOKEN_IDS = loadCharacterTokenIds();

// ============================================================
// TYPES
// ============================================================

export interface AgentState {
  id: string;
  name: string;
  class: string;
  playerId: string;
  zone: string;
  health: number;
  maxHealth: number;
  level: number;
  xp: number;
  gold: number;
  inventory: { name: string; type: string; quantity: number; tokenId: number }[];
  activeQuests: { id: string; name: string; progress: number; goal: number; goldReward: number; xpReward: number }[];
  availableQuests: { id: string; name: string; npcId: string; npcName: string; goldReward: number; xpReward: number }[];
  nearbyEntities: { id: string; type: string; name: string; level?: number; distance: number }[];
  characterTokenId: number;
  // Retained between ticks — not fetched from server
  recentActions: string[];
  deathCount: number;
  questsCompleted: string[];
}

interface Decision {
  agentId: string;
  action: "attack" | "move" | "accept_quest" | "complete_quest" | "buy_item" | "use_potion" | "wait";
  targetId?: string;
  targetName?: string;
  why: string;
}

// ============================================================
// FALLBACK AI — when Claude API is unavailable
// ============================================================

// Per-agent personality weights for fallback AI
const PERSONALITY: Record<string, { aggression: number; questFocus: number; caution: number; explorer: number }> = {
  "Ragnar":  { aggression: 0.8, questFocus: 0.3, caution: 0.2, explorer: 0.4 },  // Warrior — charges in
  "Lyria":   { aggression: 0.3, questFocus: 0.7, caution: 0.7, explorer: 0.5 },  // Mage — careful, quest-driven
  "Kira":    { aggression: 0.5, questFocus: 0.8, caution: 0.4, explorer: 0.6 },  // Ranger — efficient quester
  "Thorn":   { aggression: 0.6, questFocus: 0.4, caution: 0.3, explorer: 0.7 },  // Rogue — gold hunter
  "Elara":   { aggression: 0.2, questFocus: 0.5, caution: 0.9, explorer: 0.3 },  // Cleric — survival first
};

// Track recent fallback actions to avoid repetition
const fallbackHistory: Map<string, string[]> = new Map();

function fallbackDecision(agent: AgentState): Decision {
  const hpPct = agent.health / agent.maxHealth;
  const hasPotion = agent.inventory.some(i => /potion/i.test(i.name) && i.quantity > 0);
  const p = PERSONALITY[agent.name] || { aggression: 0.5, questFocus: 0.5, caution: 0.5, explorer: 0.5 };
  const history = fallbackHistory.get(agent.id) || [];
  const lastAction = history[history.length - 1] || "";

  // Helper to record action
  const decide = (d: Decision) => {
    history.push(d.action);
    if (history.length > 8) history.shift();
    fallbackHistory.set(agent.id, history);
    return d;
  };

  const mobs = agent.nearbyEntities.filter(e => e.type === "mob");

  // ── SURVIVAL PRIORITY ──
  // Critical HP: heal or flee
  if (hpPct < 0.2) {
    if (hasPotion) {
      const potion = agent.inventory.find(i => /potion/i.test(i.name) && i.quantity > 0);
      return decide({ agentId: agent.id, action: "use_potion", targetId: String(potion?.tokenId || "20"), why: "critical HP — emergency heal" });
    }
    if (agent.gold >= 30 && lastAction !== "buy_item") {
      return decide({ agentId: agent.id, action: "buy_item", targetId: "20", why: "critical HP — buying emergency potion" });
    }
    // Flee to human meadow if in dangerous zone
    if (agent.zone !== "human_meadow") {
      return decide({ agentId: agent.id, action: "move", targetId: "human_meadow", why: "retreating to safety" });
    }
    return decide({ agentId: agent.id, action: "wait", why: "resting — critically wounded" });
  }

  // Low HP: cautious behavior based on personality
  if (hpPct < (0.25 + p.caution * 0.2)) {
    if (hasPotion) {
      const potion = agent.inventory.find(i => /potion/i.test(i.name) && i.quantity > 0);
      return decide({ agentId: agent.id, action: "use_potion", targetId: String(potion?.tokenId || "20"), why: "low HP — healing up" });
    }
    if (agent.gold >= 30 && lastAction !== "buy_item") {
      return decide({ agentId: agent.id, action: "buy_item", targetId: "20", why: "low HP — stocking up on potions" });
    }
    // Cautious agents wait, aggressive ones keep fighting
    if (Math.random() > p.aggression) {
      return decide({ agentId: agent.id, action: "wait", why: "low HP — playing it safe" });
    }
  }

  // ── QUEST COMPLETION ──
  const readyQuest = agent.activeQuests.find(q => q.progress >= q.goal);
  if (readyQuest) {
    return decide({ agentId: agent.id, action: "complete_quest", targetId: readyQuest.id, why: `turning in ${readyQuest.name} for ${readyQuest.goldReward}g ${readyQuest.xpReward}xp` });
  }

  // ── QUEST ACCEPTANCE ── (personality-weighted)
  if (agent.activeQuests.length === 0 && agent.availableQuests.length > 0 && Math.random() < p.questFocus) {
    // Pick highest reward quest
    const sorted = [...agent.availableQuests].sort((a, b) => (b.goldReward + b.xpReward) - (a.goldReward + a.xpReward));
    const quest = sorted[0];
    return decide({ agentId: agent.id, action: "accept_quest", targetId: quest.id, why: `picking up ${quest.name} (${quest.goldReward}g ${quest.xpReward}xp reward)` });
  }

  // ── POTION STOCKPILE ── (buy potions if flush with gold and no potions)
  if (!hasPotion && agent.gold >= 60 && Math.random() < p.caution && lastAction !== "buy_item") {
    return decide({ agentId: agent.id, action: "buy_item", targetId: "20", why: "stocking potions while rich" });
  }

  // ── COMBAT ── (personality-driven target selection)
  if (mobs.length > 0 && hpPct > (0.3 + (1 - p.aggression) * 0.2)) {
    const suitable = mobs.filter(m => !m.level || m.level <= agent.level + 3);
    let target;

    if (p.aggression > 0.6) {
      // Aggressive: pick strongest mob they can handle
      target = suitable.length > 0
        ? suitable.reduce((a, b) => (a.level || 0) > (b.level || 0) ? a : b)
        : mobs[0];
    } else if (p.questFocus > 0.6 && agent.activeQuests.length > 0) {
      // Quest-focused: prefer mobs that might match quest objectives
      target = suitable.length > 0
        ? suitable[Math.floor(Math.random() * suitable.length)]
        : mobs[0];
    } else {
      // Default: weakest mob for safe grinding
      target = suitable.length > 0
        ? suitable.reduce((a, b) => (a.level || 99) < (b.level || 99) ? a : b)
        : mobs[0];
    }

    if (target) {
      return decide({ agentId: agent.id, action: "attack", targetId: target.id, why: `engaging ${target.name}` });
    }
  }

  // ── ZONE PROGRESSION ── (move to harder zones as agent levels up)
  const zoneForLevel: [number, string][] = [
    [1, "human_meadow"],
    [3, "wild_meadow"],
    [5, "dark_forest"],
  ];
  const idealZone = zoneForLevel.reduce((z, [lvl, name]) => agent.level >= lvl ? name : z, "human_meadow");

  if (idealZone !== agent.zone && Math.random() < p.explorer * 0.3) {
    return decide({ agentId: agent.id, action: "move", targetId: idealZone, why: `leveled up enough — heading to ${idealZone.replace("_", " ")}` });
  }

  // ── EXPLORATION ── (random zone change for variety)
  if (Math.random() < p.explorer * 0.08) {
    const zones = ["human_meadow", "wild_meadow", "dark_forest"].filter(z => z !== agent.zone);
    const safe = agent.level < 3 ? zones.filter(z => z !== "dark_forest") : zones;
    if (safe.length > 0) {
      const zone = safe[Math.floor(Math.random() * safe.length)];
      return decide({ agentId: agent.id, action: "move", targetId: zone, why: `exploring ${zone.replace("_", " ")}` });
    }
  }

  // ── FALLBACK ── attack or wait
  if (mobs.length > 0) {
    const mob = mobs[Math.floor(Math.random() * mobs.length)];
    return decide({ agentId: agent.id, action: "attack", targetId: mob.id, why: `grinding ${mob.name}` });
  }

  // Nothing nearby — move to find mobs
  if (lastAction === "wait") {
    const zones = ["human_meadow", "wild_meadow"].filter(z => z !== agent.zone);
    return decide({ agentId: agent.id, action: "move", targetId: zones[0], why: "no targets — moving to find mobs" });
  }

  return decide({ agentId: agent.id, action: "wait", why: "surveying the area" });
}

// ============================================================
// AGENT ROSTER
// ============================================================

const ROSTER = [
  { name: "Ragnar",  class: "Warrior", style: "aggressive, charges mobs, high risk tolerance" },
  { name: "Lyria",   class: "Mage",    style: "cautious, kites enemies, keeps distance" },
  { name: "Kira",    class: "Ranger",  style: "efficient, focuses on quest objectives only" },
  { name: "Thorn",   class: "Rogue",   style: "gold-focused, targets loot-rich mobs" },
  { name: "Elara",   class: "Cleric",  style: "survival-first, heals immediately when low" },
];

// ============================================================
// IN-MEMORY STATE (no DB per tick)
// ============================================================

let agents: AgentState[] = [];

function initAgents(count: number): AgentState[] {
  return ROSTER.slice(0, count).map((r, i) => ({
    id: `agent-${i}`,
    name: r.name,
    class: r.class,
    playerId: "",           // set after spawn
    zone: "human_meadow",
    health: 100,
    maxHealth: 100,
    level: 1,
    xp: 0,
    gold: 50,   // starter gold — enough for 2 Minor Health Potions on day 1
    inventory: [],
    activeQuests: [],
    availableQuests: [],
    nearbyEntities: [],
    characterTokenId: CHARACTER_TOKEN_IDS[`agent-${i}`] || 0,
    recentActions: [],
    deathCount: 0,
    questsCompleted: [],
  }));
}

// ============================================================
// CORE: ONE BATCH CALL — all agents, one round trip
// ============================================================

async function batchDecide(agents: AgentState[], retryCount = 0): Promise<Decision[]> {
  // Build a compact prompt with ALL agent states
  const agentSummaries = agents.map(a => `
### ${a.name} (${a.class}) | HP:${a.health}/${a.maxHealth} | Lvl:${a.level} | Gold:${a.gold}
Zone: ${a.zone} | Deaths: ${a.deathCount}
Active quests: ${a.activeQuests.map(q => `${q.name}[id:${q.id}](${q.progress}/${q.goal}${q.progress >= q.goal ? ",READY TO TURN IN" : ""})`).join(", ") || "none"}
Available quests: ${a.availableQuests.map(q => `${q.name}[id:${q.id}]from ${q.npcName}`).join(", ") || "none"}
Potions: ${a.inventory.filter(i => i.type === "potion").map(i => `${i.name}x${i.quantity}`).join(", ") || "NONE"}
Inventory: ${a.inventory.map(i => `${i.name}x${i.quantity}`).join(", ") || "empty"}
Nearby: ${a.nearbyEntities.slice(0, 5).map(e => `${e.name}[id:${e.id}](${e.type},lv${e.level || "?"},${e.distance}m)`).join(", ") || "nothing"}
Last actions: ${a.recentActions.slice(-5).join(" → ") || "none"}`
  ).join("\n");

  const prompt = `You control ${agents.length} MMORPG agents simultaneously. Decide the next action for EACH agent.

${agentSummaries}

Rules:
- CHECK POTIONS LINE FIRST. If "Potions: NONE" → you have NO potions. Do NOT use_potion.
- HP < 30% and Potions != NONE → use_potion
- HP < 30% and Potions == NONE and gold >= 30 → buy_item with targetId="20" (Minor Health Potion)
- HP < 30% and Potions == NONE and gold < 30 → attack the weakest nearby mob (you need gold!) or wait
- NEVER alternate between buy_item and use_potion repeatedly — if you just tried buy_item and it didn't work, attack or wait instead
- Never attack mobs more than 3 levels above agent level
- Complete active quests before accepting new ones
- For buy_item, targetId must be the numeric item ID: "20"=Minor Health Potion, "21"=Health Potion

CRITICAL: targetId MUST be the exact id shown in [id:xxx] brackets. For mobs, use the exact mob id like "mob_1". For quests, use the quest id. For items, use the numeric ID. NEVER use item names as targetId.

Respond with ONLY a JSON array, one object per agent, in the SAME ORDER as listed above:
[
  {"agentId":"agent-0","action":"attack|move|accept_quest|complete_quest|buy_item|use_potion|wait","targetId":"exact_id_from_brackets_or_numeric_item_id","why":"one sentence"},
  ...
]`;

  const decisions: Decision[] = agents.map(a => ({
    agentId: a.id,
    action: "wait" as const,
    why: "default",
  }));

  // If AI is paused, skip Claude API entirely and use fallback
  if (aiPaused) {
    console.log(`⏸️  AI paused — using fallback AI for ${agents.length} agents`);
    for (let i = 0; i < agents.length; i++) {
      decisions[i] = fallbackDecision(agents[i]);
    }
    await Promise.all(
      decisions.map((d, i) => executeDecision(agents[i], d).catch(console.error))
    );
    return decisions;
  }

  // Non-streaming call (lower memory usage)
  let response;
  try {
    response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
      system: "You are a game AI controller. Always respond with only valid JSON arrays. No markdown, no explanation.",
    });
  } catch (e: any) {
    if (e?.status === 429 && retryCount < 3) {
      const wait = Math.min(60000, (retryCount + 1) * 20000);
      console.warn(`⚠️  Rate limited — waiting ${wait / 1000}s before retry ${retryCount + 1}/3`);
      await sleep(wait);
      return batchDecide(agents, retryCount + 1);
    }
    console.error(`⚠️  Claude API error: ${e.message || e}`);
    // Fallback AI — make smart random decisions so the game stays alive
    console.log(`🤖 Fallback AI kicking in for ${agents.length} agents`);
    for (let i = 0; i < agents.length; i++) {
      decisions[i] = fallbackDecision(agents[i]);
    }
    await Promise.all(
      decisions.map((d, i) => executeDecision(agents[i], d).catch(console.error))
    );
    return decisions;
  }

  // Parse all decisions from the response
  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  const matches = text.matchAll(/\{[^{}]+\}/g);
  for (const match of matches) {
    try {
      const decision = JSON.parse(match[0]) as Decision;
      const idx = agents.findIndex(a => a.id === decision.agentId);
      if (idx !== -1) {
        decisions[idx] = decision;
      }
    } catch {
      // Malformed JSON chunk — skip
    }
  }

  // Execute all decisions in parallel
  await Promise.all(
    decisions.map((d, i) => executeDecision(agents[i], d).catch(console.error))
  );

  return decisions;
}

// ============================================================
// EXECUTE — runs immediately per-agent as stream arrives
// ============================================================

async function executeDecision(agent: AgentState, decision: Decision): Promise<void> {
  const label = `[${agent.name}]`;

  // ── Stuck detection: if agent has failed 3+ consecutive heal/buy attempts, force attack or wait ──
  const isHealAttempt = decision.action === "use_potion" || (decision.action === "buy_item" && /potion/i.test(decision.targetName || decision.targetId || ""));
  const fails = failedHealAttempts.get(agent.id) || 0;
  if (isHealAttempt && fails >= 3) {
    // Break the loop — find nearest mob to attack, or just wait
    const mob = agent.nearbyEntities.find(e => e.type === "mob");
    if (mob && agent.health > agent.maxHealth * 0.15) {
      console.log(`${label} 🔄 STUCK LOOP DETECTED (${fails} failed heals) — forcing attack on ${mob.name}`);
      decision = { ...decision, action: "attack", targetId: mob.id, targetName: mob.name, why: "auto: broke heal loop" };
    } else {
      console.log(`${label} 🔄 STUCK LOOP DETECTED (${fails} failed heals) — forcing wait (too low HP to fight)`);
      decision = { ...decision, action: "wait", why: "auto: broke heal loop, HP too low" };
    }
    failedHealAttempts.set(agent.id, 0);
  }

  console.log(`${label} ${decision.action}${decision.targetName ? ` → ${decision.targetName}` : ""} | ${decision.why}`);

  // Update in-memory recent actions
  agent.recentActions.push(`${decision.action}:${decision.targetName || ""}`);
  if (agent.recentActions.length > 20) agent.recentActions.shift();

  switch (decision.action) {
    case "attack": {
      const res = await serverPost("/command", {
        playerId: agent.playerId,
        command: "attack",
        targetId: decision.targetId,
      });

      if (res?.mobDied) {
        console.log(`  ⚔️  ${label} Killed ${res.mobName} (+${res.xpGained}xp, +${res.goldDropped}g)`);
        // On-chain minting now handled server-side (mints to player's wallet)
        agent.xp += res.xpGained || 0;
        agent.gold += res.goldDropped || 0;
      }

      if (res?.playerDied) {
        agent.deathCount++;
        agent.health = agent.maxHealth * 0.5; // respawn at half HP
        console.log(`  💀 ${label} Died (death #${agent.deathCount})`);
      } else if (res?.playerHealth !== undefined) {
        agent.health = res.playerHealth;
      }
      break;
    }

    case "move": {
      await serverPost("/command", {
        playerId: agent.playerId,
        command: "move",
        targetId: decision.targetId,
      });
      break;
    }

    case "accept_quest": {
      const res = await serverPost("/quests/accept", {
        playerId: agent.playerId,
        questId: decision.targetId,
        zoneId: agent.zone,
      });
      if (res?.success) console.log(`  📜 ${label} Accepted: ${res.questName}`);
      break;
    }

    case "complete_quest": {
      const quest = agent.activeQuests.find(q => q.id === decision.targetId);
      if (!quest) break;

      const res = await serverPost("/quests/complete", {
        playerId: agent.playerId,
        questId: decision.targetId,
        zoneId: agent.zone,
      });

      if (res?.success) {
        console.log(`  🏆 ${label} Completed: ${quest.name} (+${quest.goldReward}g +${quest.xpReward}xp)`);
        agent.questsCompleted.push(quest.name);
        agent.gold += quest.goldReward;
        agent.xp += quest.xpReward;
        // On-chain minting now handled server-side (mints to player's wallet)
        serverPost("/blockchain/update-leaderboard", { agent })
          .then(r => console.log(`  ⛓️ leaderboard update (${agent.name}):`, r?.success ? "✅" : r?.error || "failed"))
          .catch(e => console.log(`  ⛓️ leaderboard error (${agent.name}):`, e.message));
      }
      break;
    }

    case "buy_item": {
      // Resolve item name → numeric template ID (AI sends names like "Health Potion")
      const itemId = resolveItemId(decision.targetId, decision.targetName);
      const res = await serverPost("/shop/buy", {
        playerId: agent.playerId,
        itemId,
      });
      if (res?.success) {
        console.log(`  🛒 ${label} Bought: ${res.itemName} (spent ${res.goldSpent}g)`);
        agent.gold -= res.goldSpent || 0;
        failedHealAttempts.set(agent.id, 0);
      } else {
        console.log(`  ⚠️ ${label} Buy failed: ${res?.error || "item not found"} (tried id=${itemId})`);
        failedHealAttempts.set(agent.id, (failedHealAttempts.get(agent.id) || 0) + 1);
      }
      break;
    }

    case "use_potion": {
      const potion = agent.inventory.find(i => i.type === "potion");
      if (potion) {
        // Always use the actual inventory tokenId — AI's targetId is unreliable for items
        const res = await serverPost("/command", {
          playerId: agent.playerId,
          command: "use_item",
          itemTokenId: potion.tokenId,
        });
        if (res?.hpRestored !== undefined) {
          agent.health = res.currentHp ?? Math.min(agent.maxHealth, agent.health + res.hpRestored);
          console.log(`  🧪 ${label} Used potion (+${res.hpRestored} HP → ${agent.health}/${agent.maxHealth})`);
          failedHealAttempts.set(agent.id, 0);
        } else {
          console.log(`  ⚠️ ${label} Potion failed: ${res?.error || "unknown"}`);
          failedHealAttempts.set(agent.id, (failedHealAttempts.get(agent.id) || 0) + 1);
        }
      } else {
        // Auto-fallback: try to buy a potion instead of wasting the turn
        if (agent.gold >= 25) {
          const buyRes = await serverPost("/shop/buy", { playerId: agent.playerId, itemId: "20" });
          if (buyRes?.success) {
            console.log(`  🛒 ${label} No potions — auto-bought one (gold: ${agent.gold}→${agent.gold - 25})`);
            agent.gold = buyRes.gold ?? agent.gold - 25;
            failedHealAttempts.set(agent.id, 0);
          } else {
            console.log(`  ⚠️ ${label} No potions & buy failed: ${buyRes?.error || "unknown"}`);
            failedHealAttempts.set(agent.id, (failedHealAttempts.get(agent.id) || 0) + 1);
          }
        } else {
          console.log(`  ⚠️ ${label} No potions & not enough gold to buy (${agent.gold}g)`);
          failedHealAttempts.set(agent.id, (failedHealAttempts.get(agent.id) || 0) + 1);
        }
      }
      break;
    }

    case "wait":
      break;
  }
}

// ============================================================
// STATE SYNC — bulk fetch all agents in one server call
// ============================================================

async function syncAllStates(agents: AgentState[]): Promise<void> {
  // Single request for all agents at once
  const res = await serverPost("/state/batch", {
    playerIds: agents.map(a => a.playerId),
  }).catch(() => null);

  if (!res?.players) return;

  for (const agent of agents) {
    const serverState = res.players[agent.playerId];

    // Auto-respawn if server doesn't know this agent (e.g. after server restart)
    if (!serverState && agent.playerId) {
      console.log(`🔄 Re-spawning ${agent.name} (server lost player state)...`);
      const spawnRes = await serverPost("/spawn", {
        agentId: agent.id,
        name: agent.name,
        class: agent.class,
        zone: agent.zone || "human_meadow",
        characterTokenId: agent.characterTokenId,
      });
      if (spawnRes?.playerId) {
        agent.playerId = spawnRes.playerId;
        console.log(`  ✅ ${agent.name} re-spawned (playerId: ${agent.playerId})`);
      }
      continue;
    }

    if (!serverState) continue;

    // Merge server state into in-memory state (preserve our retained fields)
    agent.zone = serverState.zone ?? agent.zone;
    agent.health = serverState.health ?? agent.health;
    agent.maxHealth = serverState.maxHealth ?? agent.maxHealth;
    agent.level = serverState.level ?? agent.level;
    agent.xp = serverState.xp ?? agent.xp;
    agent.gold = serverState.gold ?? agent.gold;
    agent.inventory = serverState.inventory ?? agent.inventory;
    agent.activeQuests = serverState.activeQuests ?? agent.activeQuests;
    agent.availableQuests = serverState.availableQuests ?? agent.availableQuests;
    agent.nearbyEntities = serverState.nearbyEntities ?? agent.nearbyEntities;
  }
}

// ============================================================
// MAIN LOOP
// ============================================================

async function runGameLoop(): Promise<void> {
  let tick = 0;
  const startTime = Date.now();

  console.log("\n🎮 Entering game loop...\n");

  while (true) {
    tick++;
    const tickStart = Date.now();

    // 1. Sync world state (one batch request)
    await syncAllStates(agents);

    // 2. ONE Claude API call → decisions for ALL agents
    //    Execution happens as tokens stream in (inside batchDecide)
    await batchDecide(agents);

    // 3. Stats every 10 ticks
    if (tick % 10 === 0) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const tickMs = Date.now() - tickStart;
      console.log(`\n📊 Tick ${tick} | ${elapsed}s elapsed | last tick ${tickMs}ms`);
      agents.forEach(a => {
        console.log(`  ${a.name.padEnd(8)} Lv${a.level} HP:${a.health}/${a.maxHealth} Gold:${a.gold} Quests done:${a.questsCompleted.length}`);
      });
      console.log();
    }

    // 4. Print sprint standings locally (scores submitted only on-demand via /admin/submit-scores)
    if (tick % SPRINT_SUBMIT_INTERVAL === 0) {
      printStandings(agents);
    }

    // 4. Wait remainder of tick window (maintains 3s cadence)
    const elapsed = Date.now() - tickStart;
    const wait = Math.max(0, TICK_MS - elapsed);
    await sleep(wait);
  }
}

// ============================================================
// STARTUP
// ============================================================

async function main(): Promise<void> {
  const agentCount = Math.min(parseInt(process.env.AGENT_COUNT || "1"), 5);
  const serverPrivateKey = process.env.SERVER_PRIVATE_KEY;

  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
  if (!serverPrivateKey) throw new Error("SERVER_PRIVATE_KEY not set");

  console.log(`
╔══════════════════════════════════════════════╗
║       WoG MMORPG — Batch Agent System        ║
╠══════════════════════════════════════════════╣
║  Agents    : ${String(agentCount).padEnd(30)} ║
║  Model     : claude-sonnet-4-5               ║
║  Mode      : Batched + Streaming             ║
║  API calls : 1 per tick (not ${agentCount} per tick)      ║
╚══════════════════════════════════════════════╝
  `);

  // Init in-memory state
  agents = initAgents(agentCount);

  // Spawn all agents in parallel
  console.log("🌍 Spawning agents in Human Meadow...");
  await Promise.all(
    agents.map(async (agent) => {
      const res = await serverPost("/spawn", {
        agentId: agent.id,
        name: agent.name,
        class: agent.class,
        zone: "human_meadow",
        characterTokenId: agent.characterTokenId,
        serverWallet: process.env.SERVER_STACKS_ADDRESS,
      });

      if (res?.playerId) {
        agent.playerId = res.playerId;
        // Keep our loaded characterTokenId — don't overwrite with server's
        console.log(`  ✅ ${agent.name} spawned (playerId: ${agent.playerId}, token #${agent.characterTokenId})`);
      }
    })
  );

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n\n⏹️  Shutting down...");
    process.exit(0);
  });

  // Run forever
  await runGameLoop();
}

// ============================================================
// HELPERS
// ============================================================

// Map item names/strings the AI sends to actual numeric template IDs
const ITEM_NAME_TO_ID: Record<string, string> = {
  "health potion": "20", "minor health potion": "20", "potion": "20",
  "greater health potion": "22", "rusty sword": "1", "iron sword": "2",
  "cloth shirt": "10", "leather vest": "11",
};

function resolveItemId(targetId?: string, targetName?: string): string {
  // If it's already a number, use it directly
  if (targetId && /^\d+$/.test(targetId)) return targetId;
  // Try to resolve from name
  const name = (targetName || targetId || "").toLowerCase().trim();
  return ITEM_NAME_TO_ID[name] || targetId || "20"; // default to minor health potion
}

// Track consecutive failed heal attempts per agent to break loops
const failedHealAttempts = new Map<string, number>();

async function serverPost(path: string, body: any): Promise<any> {
  const payload = JSON.stringify(body);
  const url = new URL(path, SERVER_URL);

  return new Promise((resolve) => {
    const req = require("http").request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res: any) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data)); } catch { resolve(null); }
          } else {
            if (res.statusCode !== 400) console.warn(`⚠️  ${path} → ${res.statusCode}: ${data.slice(0, 120)}`);
            resolve(null);
          }
        });
      }
    );
    req.on("error", (e: any) => {
      console.warn(`⚠️  ${path} request failed: ${e.code || e.message} → ${url.href}`);
      resolve(null);
    });
    req.write(payload);
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// RUN
// ============================================================

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
