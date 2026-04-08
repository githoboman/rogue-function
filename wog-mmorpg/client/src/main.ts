/**
 * main.ts — Phaser Game Entry Point
 * Boots Phaser, connects WebSocket, drives all UI
 */

import Phaser from "phaser";
import { PreloadScene } from "./scenes/PreloadScene";
import { GameScene }    from "./scenes/GameScene";
import { gameWS }       from "./ws";
import {
  animate,
  animateCardEnter,
  flashCardDamage,
  flashCardLevelUp,
  animateLogEntry,
  staggerRows,
  animateNumber,
  spawnBanner,
} from "./anime-utils";

// ── Kill Feed (in-game overlay entries) ──────────────────────────────────────
function addKillfeed(text: string, type: "kill" | "level" | "quest" | "streak") {
  const feed = document.getElementById("killfeed");
  if (!feed) return;
  const el = document.createElement("div");
  el.className = `kf-entry ${type === "kill" ? "" : type}`;
  el.textContent = text;
  feed.appendChild(el);

  // Slide in from right
  animate(el, { translateX: [60, 0], opacity: [0, 1], duration: 240, easing: "easeOutCubic" });
  // Fade out after 3s
  animate(el, { opacity: 0, translateX: [0, -20], duration: 400, delay: 2800, easing: "easeInCubic",
    onComplete: () => el.remove() });

  // Keep max 6 entries
  while (feed.children.length > 6) feed.removeChild(feed.firstChild!);
}

// ============================================================
// PHASER CONFIG
// ============================================================

const gameContainer = document.getElementById("game-container")!;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-container",
  backgroundColor: "#1a2a18",
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
(window as any).__SHARD_URL = API_URL;

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

  // Server wraps event fields inside event.data — unwrap so we can read them directly
  const d = event.data || event;

  const gs = game.scene.getScene("GameScene") as GameScene | null;

  switch (event.type) {
    case "combat_hit": {
      addLog(`${d.playerName} hits ${d.mobName} for ${d.damage}${d.crit ? " CRIT" : ""}`, "combat");
      const hitCard = document.querySelector(`[data-agent="${d.playerId}"]`) as HTMLElement | null;
      if (hitCard) flashCardDamage(hitCard);
      break;
    }

    case "mob_died": {
      globalStats.totalKills++;
      globalStats.totalGoldEarned += d.goldDropped || 0;
      addLog(`${d.mobName} slain! +${d.xpGained}xp +${d.goldDropped}g`, "combat");
      if (d.loot?.length) addLog(`Loot: ${d.loot.join(", ")}`, "loot");
      addKillfeed(`${d.playerName || "?"} slew ${d.mobName} +${d.goldDropped}g`, "kill");

      // Track earnings per agent
      if (d.playerId) {
        const e = agentEarnings.get(d.playerId);
        if (e) {
          e.goldEarned += d.goldDropped || 0;
          e.xpEarned += d.xpGained || 0;
          e.kills++;
        }
      }

      // Kill streak tracking
      if (d.playerName) {
        const now = Date.now();
        const streak = killStreaks.get(d.playerName) || { count: 0, lastKillTime: 0 };
        if (now - streak.lastKillTime < STREAK_TIMEOUT_MS) {
          streak.count++;
        } else {
          streak.count = 1;
        }
        streak.lastKillTime = now;
        killStreaks.set(d.playerName, streak);

        if (streak.count === 3) {
          addLog(`${d.playerName} is on a KILLING SPREE!`, "streak");
          addKillfeed(`${d.playerName}: KILLING SPREE!`, "streak");
          spawnBanner("KILLING SPREE", d.playerName, "streak");
        } else if (streak.count === 5) {
          addLog(`${d.playerName} is UNSTOPPABLE!`, "streak");
          addKillfeed(`${d.playerName}: UNSTOPPABLE!`, "streak");
          spawnBanner("UNSTOPPABLE", d.playerName, "streak");
        } else if (streak.count === 8) {
          addLog(`${d.playerName} is GODLIKE!`, "streak");
          addKillfeed(`${d.playerName}: GODLIKE!`, "streak");
          spawnBanner("GODLIKE", d.playerName, "streak");
        }
      }
      break;
    }

    case "player_died":
      addLog(`${d.playerName} was slain!`, "death");
      addKillfeed(`${d.playerName} fell in battle`, "kill");
      killStreaks.delete(d.playerName);
      break;

    case "player_levelup": {
      addLog(`${d.playerName} reached Level ${d.newLevel}!`, "level");
      gs?.onLevelUp?.(d.playerId, d.newLevel);
      addKillfeed(`${d.playerName} → Level ${d.newLevel}!`, "level");
      const lvlCard = document.querySelector(`[data-agent="${d.playerId}"]`) as HTMLElement | null;
      if (lvlCard) flashCardLevelUp(lvlCard);
      break;
    }

    case "quest_accepted":
      addLog(`${d.playerName} accepted: ${d.questName}`, "quest");
      break;

    case "quest_completed": {
      addLog(`${d.playerName} completed: ${d.questName} (+${d.goldReward}g +${d.xpReward}xp)`, "quest");
      addKillfeed(`${d.playerName}: ${d.questName} ✓`, "quest");
      // Track quest earnings
      if (d.playerId) {
        const e = agentEarnings.get(d.playerId);
        if (e) {
          e.goldEarned += d.goldReward || 0;
          e.xpEarned += d.xpReward || 0;
        }
      }
      break;
    }

    case "zone_transition":
      addLog(`${d.playerName} moved to ${(d.toZone || "").replace(/_/g, " ")}`, "zone");
      break;

    case "agent_decision":
      updateAgentAction(d.playerId, d.action, d.target);
      // Show action icon in game world
      gs?.showAgentStatus?.(d.playerId, d.action, d.target);
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

let _prevKills = 0;
let _prevGold = 0;
function updateTopbarStats(agents: any[]): void {
  globalStats.playerCount = agents.length;
  const playersEl = document.getElementById("stat-players");
  const killsEl = document.getElementById("stat-kills");
  const goldEl = document.getElementById("stat-gold");
  if (playersEl) playersEl.textContent = String(globalStats.playerCount);
  if (killsEl && globalStats.totalKills !== _prevKills) {
    animateNumber(killsEl, _prevKills, globalStats.totalKills, 400);
    _prevKills = globalStats.totalKills;
  }
  if (goldEl && globalStats.totalGoldEarned !== _prevGold) {
    animateNumber(goldEl, _prevGold, globalStats.totalGoldEarned, 600);
    _prevGold = globalStats.totalGoldEarned;
  }
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
    const color = CLASS_COLORS[agent.class] || "#888";
    const initial = agent.name.charAt(0).toUpperCase();

    if (!card) {
      card = document.createElement("div");
      card.className = "agent-card";
      card.dataset.agent = agent.id;
      card.dataset.class = agent.class;
      card.innerHTML = `
        <div class="agent-header">
          <div class="agent-name-group">
            <div class="agent-avatar" style="background:${color}">${initial}</div>
            <div>
              <div class="agent-name">${agent.name}</div>
              <div class="agent-class-tag">${agent.class}</div>
            </div>
          </div>
          <span class="agent-level" data-lvl>Lv${agent.level}</span>
        </div>
        <div class="agent-zone-tag" data-zone><span class="zone-dot"></span>${zone}</div>
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
          <span class="stat-gold">G <span data-gold>${gold}</span></span>
          <span class="stat-quests">Q <span data-quests>${questsDone}</span></span>
        </div>
        <div class="agent-action" data-action>&mdash;</div>
      `;
      panel.appendChild(card);
      // Animate new card entering
      animateCardEnter(card, panel.children.length - 1);
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
      if (zoneEl) zoneEl.innerHTML = `<span class="zone-dot"></span>${zone}`;
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

  panel.innerHTML = entries.map((e, i) => {
    const color = CLASS_COLORS[e.cls] || "#888";
    const initial = e.name.charAt(0).toUpperCase();
    const rankClass = i === 0 ? "top1" : i === 1 ? "top2" : i === 2 ? "top3" : "";
    const rankIcon = i === 0 ? "\u{1F947}" : i === 1 ? "\u{1F948}" : i === 2 ? "\u{1F949}" : `${i + 1}`;
    return `<div class="earnings-row">
      <div class="earnings-rank ${rankClass}">${rankIcon}</div>
      <div class="earnings-avatar" style="background:${color}">${initial}</div>
      <div class="earnings-info">
        <div class="earnings-name">${e.name}</div>
        <div class="earnings-detail">
          <span class="earnings-detail-item" style="color:#cc6666">${e.kills} kills</span>
          <span class="earnings-detail-item" style="color:#6aaa6a">${e.questsCompleted} quests</span>
        </div>
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
      gold: a.gold ?? 0,
      quests: a.questsCompleted ?? 0,
      xp: a.xp ?? 0,
    }))
    .sort((a, b) => b.score - a.score);

  const medals = ["gold", "silver", "bronze"];
  const medalIcons = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];

  const prevContent = panel.innerHTML;
  panel.innerHTML = scored.map((s, i) => {
    const rankClass = i < 3 ? medals[i] : "normal";
    const icon = i < 3 ? medalIcons[i] : `${i + 1}`;
    const color = CLASS_COLORS[s.cls] || "#888";
    const initial = s.name.charAt(0).toUpperCase();
    const isFirst = i === 0;
    return `<div class="lb-row${isFirst ? " first" : ""}">
      <span class="lb-rank ${rankClass}">${icon}</span>
      <div class="lb-avatar" style="background:${color}">${initial}</div>
      <div class="lb-info">
        <div class="lb-name">${s.name}</div>
        <div class="lb-class">${s.cls} &middot; ${s.quests}Q &middot; ${s.gold}G</div>
      </div>
      <div class="lb-score-col">
        <div class="lb-score">${s.score.toLocaleString()}</div>
        <div class="lb-breakdown">${s.xp}xp</div>
      </div>
    </div>`;
  }).join("");

  // Stagger-animate rows when leaderboard changes
  if (prevContent !== panel.innerHTML) staggerRows(panel);
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
  animateLogEntry(entry);
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
