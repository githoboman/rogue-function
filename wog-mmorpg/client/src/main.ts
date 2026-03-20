/**
 * main.ts — Phaser Game Entry Point
 * Boots Phaser, connects WebSocket, drives all UI
 */

import Phaser from "phaser";
import { PreloadScene } from "./scenes/PreloadScene";
import { GameScene }    from "./scenes/GameScene";
import { gameWS }       from "./ws";

// ============================================================
// PHASER CONFIG
// ============================================================

const gameContainer = document.getElementById("game-container")!;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-container",
  backgroundColor: "#080810",
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [PreloadScene, GameScene],
  render: { antialias: false, pixelArt: true },
});

window.addEventListener("resize", () => {
  game.scale.resize(gameContainer.offsetWidth, gameContainer.offsetHeight);
});

// ============================================================
// SERVER URL
// ============================================================

const SHARD_URL = (import.meta as any).env?.VITE_SHARD_URL || "";
const WS_URL = (import.meta as any).env?.VITE_WS_URL
  || (SHARD_URL ? SHARD_URL.replace(/^http/, "ws") + "/ws" : "")
  || `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
const API_URL = SHARD_URL || `${location.protocol}//${location.host}`;

// ============================================================
// GLOBAL STATS TRACKING
// ============================================================

const globalStats = {
  totalKills: 0,
  totalGoldEarned: 0,
  playerCount: 0,
};

// Kill streak tracking per agent
const killStreaks = new Map<string, { count: number; lastKillTime: number }>();
const STREAK_TIMEOUT_MS = 15000;

// Agent earnings tracking
interface AgentEarnings {
  name: string;
  cls: string;
  goldEarned: number;
  xpEarned: number;
  kills: number;
  questsCompleted: number;
}
const agentEarnings = new Map<string, AgentEarnings>();

// ============================================================
// WEBSOCKET
// ============================================================

gameWS.connect(WS_URL);

// Push world snapshots into GameScene each tick
gameWS.onSnapshot((snapshot: any) => {
  const agents = snapshot.agents || [];
  updateAgentPanel(agents);
  updateLeaderboard(agents);
  updateEarnings(agents);
  updateTickCount();
  updateTopbarStats(agents);

  const gs = game.scene.getScene("GameScene") as GameScene | null;
  if (!gs?.scene.isActive()) return;

  for (const agent of agents) {
    gs.upsertAgent(agent.id, {
      playerId:     agent.id,
      zone:         agent.zone,
      position:     { x: agent.x ?? 100, y: agent.y ?? 100 },
      health:       agent.hp,
      maxHealth:    agent.maxHp,
      level:        agent.level,
      xp:           agent.xp,
      inventory:    [],
      activeQuests: [],
      nearbyEntities: [],
    }, agent.name, agent.class);

    // Init earnings entry if new
    if (!agentEarnings.has(agent.id)) {
      agentEarnings.set(agent.id, {
        name: agent.name,
        cls: agent.class,
        goldEarned: 0,
        xpEarned: 0,
        kills: 0,
        questsCompleted: agent.questsCompleted ?? 0,
      });
    } else {
      const e = agentEarnings.get(agent.id)!;
      e.questsCompleted = agent.questsCompleted ?? 0;
    }
  }

  const zoneList = Array.isArray(snapshot.zones)
    ? snapshot.zones
    : Object.entries(snapshot.zones || {}).map(([id, z]: [string, any]) => ({ ...z, id }));

  for (const zone of zoneList) {
    if (!zone.mobs) continue;
    for (const mob of zone.mobs) {
      if (mob.alive !== false) gs.upsertMob(mob.id, mob, zone.id);
    }
  }
});

// Game events -> combat log + GameScene effects
gameWS.onEvent((event: any) => {
  if (event.type === "tick" || event.type === "history") return;

  const gs = game.scene.getScene("GameScene") as GameScene | null;

  switch (event.type) {
    case "combat_hit":
      addLog(`${event.playerName} hits ${event.mobName} for ${event.damage}${event.crit ? " CRIT" : ""}`, "combat");
      break;

    case "mob_died": {
      globalStats.totalKills++;
      globalStats.totalGoldEarned += event.goldDropped || 0;
      addLog(`${event.mobName} slain! +${event.xpGained}xp +${event.goldDropped}g`, "combat");
      if (event.loot?.length) addLog(`Loot: ${event.loot.join(", ")}`, "loot");

      // Track earnings per agent
      if (event.playerId) {
        const e = agentEarnings.get(event.playerId);
        if (e) {
          e.goldEarned += event.goldDropped || 0;
          e.xpEarned += event.xpGained || 0;
          e.kills++;
        }
      }

      // Kill streak tracking
      if (event.playerName) {
        const now = Date.now();
        const streak = killStreaks.get(event.playerName) || { count: 0, lastKillTime: 0 };
        if (now - streak.lastKillTime < STREAK_TIMEOUT_MS) {
          streak.count++;
        } else {
          streak.count = 1;
        }
        streak.lastKillTime = now;
        killStreaks.set(event.playerName, streak);

        if (streak.count === 3) addLog(`${event.playerName} is on a KILLING SPREE!`, "streak");
        else if (streak.count === 5) addLog(`${event.playerName} is UNSTOPPABLE!`, "streak");
        else if (streak.count === 8) addLog(`${event.playerName} is GODLIKE!`, "streak");
      }
      break;
    }

    case "player_died":
      addLog(`${event.playerName} was slain!`, "death");
      killStreaks.delete(event.playerName);
      break;

    case "player_levelup":
      addLog(`${event.playerName} reached Level ${event.newLevel}!`, "level");
      gs?.onLevelUp?.(event.playerId, event.newLevel);
      break;

    case "quest_accepted":
      addLog(`${event.playerName} accepted: ${event.questName}`, "quest");
      break;

    case "quest_completed": {
      addLog(`${event.playerName} completed: ${event.questName} (+${event.goldReward}g +${event.xpReward}xp)`, "quest");
      // Track quest earnings
      if (event.playerId) {
        const e = agentEarnings.get(event.playerId);
        if (e) {
          e.goldEarned += event.goldReward || 0;
          e.xpEarned += event.xpReward || 0;
        }
      }
      break;
    }

    case "zone_transition":
      addLog(`${event.playerName} moved to ${(event.toZone || "").replace(/_/g, " ")}`, "zone");
      break;

    case "agent_decision":
      updateAgentAction(event.playerId, event.action, event.target);
      break;
  }
});

// ============================================================
// ZONE TABS
// ============================================================

document.querySelectorAll(".zone-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".zone-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    const zone = (tab as HTMLElement).dataset.zone || "human_meadow";
    const gs = game.scene.getScene("GameScene") as GameScene | null;
    gs?.setZone(zone);
  });
});

// ============================================================
// TOPBAR STATS
// ============================================================

function updateTopbarStats(agents: any[]): void {
  globalStats.playerCount = agents.length;
  const playersEl = document.getElementById("stat-players");
  const killsEl = document.getElementById("stat-kills");
  const goldEl = document.getElementById("stat-gold");
  if (playersEl) playersEl.textContent = String(globalStats.playerCount);
  if (killsEl) killsEl.textContent = String(globalStats.totalKills);
  if (goldEl) goldEl.textContent = formatGold(globalStats.totalGoldEarned);
}

function formatGold(g: number): string {
  if (g >= 10000) return `${(g / 1000).toFixed(1)}k`;
  return String(g);
}

// ============================================================
// AGENT PANEL UI
// ============================================================

const ZONE_LABELS: Record<string, string> = {
  human_meadow: "Human Meadow",
  wild_meadow:  "Wild Meadow",
  dark_forest:  "Dark Forest",
};

const CLASS_COLORS: Record<string, string> = {
  Warrior: "#dd6644", Mage: "#7766ee", Ranger: "#55bb55", Cleric: "#eebb33",
  Rogue: "#cc5588", Paladin: "#4499ee", Necromancer: "#9944cc", Druid: "#44bb99",
};

function updateAgentPanel(agents: any[]): void {
  const panel = document.getElementById("agents-list");
  const countEl = document.getElementById("agents-count");
  if (!panel) return;
  if (countEl) countEl.textContent = String(agents.length);

  for (const agent of agents) {
    let card = panel.querySelector(`[data-agent="${agent.id}"]`) as HTMLElement | null;
    const hpPct  = Math.max(0, Math.min(1, agent.hp / agent.maxHp));
    const hpClass = hpPct < 0.3 ? "low" : hpPct < 0.6 ? "mid" : "";
    const zone    = ZONE_LABELS[agent.zone] || agent.zone;
    const gold    = agent.gold ?? 0;
    const questsDone = agent.questsCompleted ?? 0;
    const xp = agent.xp ?? 0;

    if (!card) {
      card = document.createElement("div");
      card.className = "agent-card";
      card.dataset.agent = agent.id;
      card.dataset.class = agent.class;
      card.innerHTML = `
        <div class="agent-header">
          <span class="agent-name">${agent.name}</span>
          <span class="agent-level" data-lvl>Lv${agent.level}</span>
        </div>
        <div class="agent-class-zone" data-zone>${agent.class} &middot; ${zone}</div>
        <div class="bar-row">
          <span class="bar-label">HP</span>
          <div class="bar-track"><div class="bar-fill hp ${hpClass}" data-hp style="width:${Math.round(hpPct*100)}%"></div></div>
          <span class="bar-value" data-hpval>${agent.hp}/${agent.maxHp}</span>
        </div>
        <div class="bar-row">
          <span class="bar-label">XP</span>
          <div class="bar-track"><div class="bar-fill xp" data-xpbar style="width:${Math.min(100, (xp % 300) / 3)}%"></div></div>
          <span class="bar-value" data-xpval>${xp}</span>
        </div>
        <div class="agent-stats-row">
          <span class="stat-gold"><span class="stat-icon">G</span> <span data-gold>${gold}</span></span>
          <span class="stat-quests"><span class="stat-icon">Q</span> <span data-quests>${questsDone}</span></span>
        </div>
        <div class="agent-action" data-action>&mdash;</div>
      `;
      panel.appendChild(card);
    } else {
      const hpEl   = card.querySelector("[data-hp]") as HTMLElement;
      const hpValEl = card.querySelector("[data-hpval]") as HTMLElement;
      const xpBarEl = card.querySelector("[data-xpbar]") as HTMLElement;
      const xpValEl = card.querySelector("[data-xpval]") as HTMLElement;
      const lvlEl  = card.querySelector("[data-lvl]") as HTMLElement;
      const zoneEl = card.querySelector("[data-zone]") as HTMLElement;
      const goldEl = card.querySelector("[data-gold]") as HTMLElement;
      const questsEl = card.querySelector("[data-quests]") as HTMLElement;

      if (hpEl) {
        hpEl.style.width = `${Math.round(hpPct*100)}%`;
        hpEl.className = `bar-fill hp ${hpClass}`;
      }
      if (hpValEl) hpValEl.textContent = `${agent.hp}/${agent.maxHp}`;
      if (xpBarEl) xpBarEl.style.width = `${Math.min(100, (xp % 300) / 3)}%`;
      if (xpValEl) xpValEl.textContent = String(xp);
      if (lvlEl) lvlEl.textContent = `Lv${agent.level}`;
      if (zoneEl) zoneEl.textContent = `${agent.class} \u00B7 ${zone}`;
      if (goldEl) goldEl.textContent = String(gold);
      if (questsEl) questsEl.textContent = String(questsDone);
    }
  }
}

function updateAgentAction(playerId: string, action: string, target: string): void {
  const card = document.querySelector(`[data-agent="${playerId}"]`);
  const el = card?.querySelector("[data-action]") as HTMLElement | null;
  if (el) el.textContent = `${action} ${target || ""}`.slice(0, 40);
}

// ============================================================
// AGENT EARNINGS
// ============================================================

function updateEarnings(_agents: any[]): void {
  const panel = document.getElementById("earnings-list");
  const badgeEl = document.getElementById("earnings-total-badge");
  if (!panel) return;

  // Collect and sort by gold earned
  const entries = Array.from(agentEarnings.entries())
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => b.goldEarned - a.goldEarned);

  const totalGold = entries.reduce((sum, e) => sum + e.goldEarned, 0);
  if (badgeEl) badgeEl.textContent = `${formatGold(totalGold)}g`;

  if (entries.length === 0) {
    panel.innerHTML = `<div style="padding:12px 18px;font-size:10px;color:#2a2a3a;">No earnings yet...</div>`;
    return;
  }

  panel.innerHTML = entries.map(e => {
    const color = CLASS_COLORS[e.cls] || "#888";
    const initial = e.name.charAt(0).toUpperCase();
    return `<div class="earnings-row">
      <div class="earnings-avatar" style="background:${color}">${initial}</div>
      <div class="earnings-info">
        <div class="earnings-name">${e.name}</div>
        <div class="earnings-detail">${e.kills} kills &middot; ${e.questsCompleted} quests</div>
      </div>
      <div class="earnings-values">
        <div class="earnings-gold">${formatGold(e.goldEarned)}g</div>
        <div class="earnings-xp">${formatGold(e.xpEarned)} xp</div>
      </div>
    </div>`;
  }).join("") + `
    <div class="earnings-total">
      <span class="earnings-total-label">Total Earned</span>
      <span class="earnings-total-val">${formatGold(totalGold)}g</span>
    </div>`;
}

// ============================================================
// LEADERBOARD
// ============================================================

function updateLeaderboard(agents: any[]): void {
  const panel = document.getElementById("leaderboard-list");
  if (!panel) return;

  const scored = agents
    .map(a => ({
      name: a.name,
      cls: a.class,
      score: (a.questsCompleted ?? 0) * 100 + (a.gold ?? 0) + (a.xp ?? 0),
    }))
    .sort((a, b) => b.score - a.score);

  const medals = ["gold", "silver", "bronze"];
  const medalIcons = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];

  panel.innerHTML = scored.map((s, i) => {
    const rankClass = i < 3 ? medals[i] : "normal";
    const icon = i < 3 ? medalIcons[i] : `${i + 1}`;
    return `<div class="lb-row">
      <span class="lb-rank ${rankClass}">${icon}</span>
      <span class="lb-name">${s.name}</span>
      <span class="lb-score">${s.score.toLocaleString()}</span>
    </div>`;
  }).join("");
}

// ============================================================
// COMBAT LOG
// ============================================================

let tickCount = 0;
function updateTickCount(): void {
  const el = document.getElementById("tick-count");
  if (el) el.textContent = `tick ${++tickCount}`;
}

function addLog(text: string, type: string): void {
  const panel = document.getElementById("event-log");
  if (!panel) return;
  const now  = new Date();
  const time = `${now.getHours().toString().padStart(2,"0")}:${now.getMinutes().toString().padStart(2,"0")}:${now.getSeconds().toString().padStart(2,"0")}`;
  const entry = document.createElement("div");
  entry.className = `event-entry ${type}`;
  entry.innerHTML = `<span class="event-time">${time}</span><span class="event-text">${text}</span>`;
  panel.appendChild(entry);
  panel.scrollTop = panel.scrollHeight;
  while (panel.children.length > 100) panel.removeChild(panel.firstChild!);
}

addLog("Connecting to shard server...", "system");

// ============================================================
// JOIN GAME — spawn a user agent from the browser
// ============================================================

function setupJoinForm(): void {
  const form = document.getElementById("join-form") as HTMLFormElement | null;
  const joinBtn = document.getElementById("join-btn") as HTMLButtonElement | null;
  const joinStatus = document.getElementById("join-status") as HTMLElement | null;
  if (!form || !joinBtn) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    joinBtn.disabled = true;
    joinBtn.textContent = "Spawning...";
    if (joinStatus) joinStatus.textContent = "";

    const name = (document.getElementById("join-name") as HTMLInputElement).value.trim() || "Adventurer";
    const cls = (document.getElementById("join-class") as HTMLSelectElement).value;
    const wallet = (document.getElementById("join-wallet") as HTMLInputElement)?.value.trim() || "";
    const apiKey = (document.getElementById("join-apikey") as HTMLInputElement).value.trim();

    if (!apiKey) {
      if (joinStatus) joinStatus.textContent = "API key required";
      joinBtn.disabled = false;
      joinBtn.textContent = "Join Game";
      return;
    }

    try {
      const res = await fetch(`${API_URL}/spawn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, class: cls, zone: "human_meadow", wallet }),
      });

      if (!res.ok) throw new Error("Spawn failed");
      const data = await res.json();

      if (joinStatus) joinStatus.textContent = `Spawned! Playing as ${name}`;
      joinStatus?.classList.add("success");

      runBrowserAgent(data.playerId, name, cls, apiKey);

      form.style.display = "none";
      const controls = document.getElementById("agent-controls");
      if (controls) {
        controls.style.display = "block";
        const walletInfo = wallet
          ? `<span style="color:#c8a84b;font-size:11px;">Earning to: ${wallet.slice(0, 8)}...${wallet.slice(-4)}</span>`
          : `<span style="color:#3a3a4a;font-size:11px;">No wallet — rewards are in-game only</span>`;
        controls.innerHTML = `
          <div style="padding:14px 18px;font-size:12px;color:#44cc66;">
            Playing as <b>${name}</b> the ${cls}<br>
            ${walletInfo}<br>
            <span style="color:#333344;font-size:10px;margin-top:4px;display:inline-block;">Your agent is making decisions automatically</span>
          </div>
        `;
      }
    } catch (err: any) {
      if (joinStatus) joinStatus.textContent = `Error: ${err.message}`;
      joinBtn.disabled = false;
      joinBtn.textContent = "Join Game";
    }
  });
}

async function runBrowserAgent(playerId: string, name: string, _cls: string, apiKey: string): Promise<void> {
  try {
    const regRes = await fetch(`${API_URL}/player/register-ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId, apiKey }),
    });
    if (!regRes.ok) throw new Error("Failed to register AI key");
  } catch (err: any) {
    addLog(`AI registration failed: ${err.message}`, "system");
    return;
  }

  addLog(`AI agent active — server is making decisions for ${name}`, "system");

  async function pollActions() {
    try {
      const res = await fetch(`${API_URL}/player/ai-status?playerId=${encodeURIComponent(playerId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.lastAction) {
          addLog(`[You] ${data.lastAction}`, "quest");
        }
      }
    } catch {}
    setTimeout(pollActions, 3500);
  }
  setTimeout(pollActions, 2000);
}

// Init join form
setupJoinForm();
