/**
 * estate.ts — Estate Panels dashboard.
 *
 * Standalone page (estate.html) that visualizes the World of Guilds autonomous
 * economy in the mockup's teal dashboard style. Binds to the SAME live data the
 * game uses: WS `tick` snapshots for agent state, and the shard REST endpoints
 * `/properties`, `/properties/all`, `/foxmq/snapshot` for the property market
 * and mesh. Falls back to representative sample data (mapped to the real WoG
 * agents Ragnar / Lyria / Kira) until the first live payload arrives.
 */

import { gameWS } from "./ws";

const WS_URL =
  (import.meta as any).env?.VITE_WS_URL ||
  `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
const API_URL =
  (import.meta as any).env?.VITE_SHARD_URL || `${location.protocol}//${location.host}`;

// ── Types ────────────────────────────────────────────────────
interface Agent {
  id: string;
  hp: number;
  maxHp: number;
  gold: number;
  level: number;
  zone: string | null;
  properties: string[];
  passiveIncome: number;
  alive: boolean;
}
interface PropDef {
  id: string; name: string; zone: string; tier: number;
  priceGold: number; rentPerTick: number; description?: string;
}
interface PropState {
  def: PropDef; owner: string | null; ownerName?: string;
  listedFor: number | null; totalEarned: number; rentPerTick: number;
}

// ── Visual mapping (real game → mockup vocabulary) ───────────
const RARITY_BY_CLASS: Record<string, "legendary" | "epic" | "rare"> = {
  warrior: "legendary", mage: "epic", rogue: "rare", ranger: "rare",
};
const AVATAR: Record<string, string> = {
  ragnar: "⚔️", lyria: "🔮", kira: "🗡️", warrior: "⚔️", mage: "🔮", rogue: "🗡️",
};
const TIER_STYLE = ["", "Cottage", "Homestead", "Manor", "Fortress"];
const TIER_EMOJI = ["", "🏡", "🏘️", "🏰", "🏯"];
const TIER_INCOME_LABEL = ["", "Residential", "Commercial", "Estate", "Stronghold"];
const TIER_COLOR = ["", "#38e0d8", "#5aa0e6", "#b57ce0", "#e6c25a"];

// ── State ────────────────────────────────────────────────────
let agents: Record<string, Agent> = {};
let properties: PropState[] = [];
let incomeHistory: number[] = [];
let tick = 0;
let gotLiveTick = false;
let gotLiveProps = false;

// ── Sample fallback (mapped to real agents) ──────────────────
function seedSample() {
  agents = {
    ragnar: { id: "ragnar", hp: 92, maxHp: 120, gold: 3450, level: 8, zone: "Volcano", properties: ["dark_castle_1", "wild_manor_1"], passiveIncome: 154, alive: true },
    lyria:  { id: "lyria",  hp: 78, maxHp: 100, gold: 5120, level: 10, zone: "Glacier", properties: ["dark_manor_1"], passiveIncome: 58, alive: true },
    kira:   { id: "kira",   hp: 64, maxHp: 90,  gold: 2180, level: 6, zone: "Dungeon", properties: ["meadow_manor_1"], passiveIncome: 22, alive: true },
  };
  properties = [
    { def: { id: "dark_castle_1", name: "Shadowgate Castle", zone: "dark_forest", tier: 4, priceGold: 6000, rentPerTick: 120 }, owner: "ragnar", ownerName: "Ragnar", listedFor: null, totalEarned: 4200, rentPerTick: 120 },
    { def: { id: "dark_manor_1", name: "Necromancer's Tower", zone: "dark_forest", tier: 3, priceGold: 3000, rentPerTick: 58 }, owner: "lyria", ownerName: "Lyria", listedFor: null, totalEarned: 1900, rentPerTick: 58 },
    { def: { id: "wild_manor_1", name: "Elias's Hunting Lodge", zone: "wild_meadow", tier: 3, priceGold: 1800, rentPerTick: 34 }, owner: "ragnar", ownerName: "Ragnar", listedFor: null, totalEarned: 980, rentPerTick: 34 },
    { def: { id: "meadow_manor_1", name: "Aldric's Manor", zone: "human_meadow", tier: 3, priceGold: 1200, rentPerTick: 22 }, owner: "kira", ownerName: "Kira", listedFor: null, totalEarned: 540, rentPerTick: 22 },
  ];
  incomeHistory = [180, 210, 240, 205, 260, 288, 310];
}

// ── Data fetch ───────────────────────────────────────────────
async function fetchProperties() {
  try {
    const res = await fetch(`${API_URL}/properties/all`);
    if (!res.ok) return;
    const data = await res.json();
    const list: PropState[] = (data.properties || data || []) as PropState[];
    if (Array.isArray(list) && list.length) {
      properties = list;
      gotLiveProps = true;
    }
  } catch { /* keep sample */ }
}

async function fetchMesh() {
  try {
    const res = await fetch(`${API_URL}/foxmq/snapshot`);
    if (!res.ok) return;
    const snap = await res.json();
    for (const a of snap.agents || []) {
      const id = (a.name || a.id || "").toLowerCase();
      if (!id) continue;
      agents[id] = {
        id,
        hp: a.hp ?? agents[id]?.hp ?? 0,
        maxHp: a.maxHp ?? agents[id]?.maxHp ?? 100,
        gold: a.gold ?? agents[id]?.gold ?? 0,
        level: a.level ?? agents[id]?.level ?? 1,
        zone: a.zone ?? null,
        properties: a.properties ?? [],
        passiveIncome: a.passiveIncome ?? 0,
        alive: a.alive ?? true,
      };
    }
  } catch { /* keep sample */ }
}

// Live agent state from WS tick snapshots
gameWS.onSnapshot((snap: any) => {
  gotLiveTick = true;
  tick = snap.tick ?? tick + 1;
  for (const a of snap.agents || []) {
    const id = (a.id || a.name || "").toLowerCase();
    if (!id) continue;
    const prev = agents[id];
    agents[id] = {
      id,
      hp: a.hp ?? prev?.hp ?? 0,
      maxHp: a.maxHp ?? prev?.maxHp ?? 100,
      gold: a.gold ?? prev?.gold ?? 0,
      level: a.level ?? prev?.level ?? 1,
      zone: a.zone ?? prev?.zone ?? null,
      properties: a.properties ?? prev?.properties ?? [],
      passiveIncome: a.passiveIncome ?? prev?.passiveIncome ?? 0,
      alive: a.alive ?? true,
    };
  }
  // track total passive income over time for the sparkline
  const totalPassive = properties.reduce((s, p) => s + (p.owner ? p.rentPerTick : 0), 0);
  if (totalPassive > 0) {
    incomeHistory.push(totalPassive);
    if (incomeHistory.length > 7) incomeHistory.shift();
  }
});

// ── Derived helpers ──────────────────────────────────────────
const ownedProps = () => properties.filter((p) => p.owner);
const agentClass = (id: string): string => {
  if (id.includes("ragnar")) return "warrior";
  if (id.includes("lyria")) return "mage";
  if (id.includes("kira")) return "rogue";
  return "ranger";
};
const successPct = (a: Agent): number => {
  // A legible "success" proxy: HP ratio blended with wealth. Deterministic.
  const hpr = a.maxHp ? a.hp / a.maxHp : 0.5;
  const wealth = Math.min(1, a.gold / 6000);
  return Math.round((hpr * 0.5 + wealth * 0.5) * 100);
};

// ── Render ───────────────────────────────────────────────────
function render() {
  const owned = ownedProps();
  const totalPassive = owned.reduce((s, p) => s + p.rentPerTick, 0);
  const totalGold = Object.values(agents).reduce((s, a) => s + a.gold, 0);
  const agentList = Object.values(agents);
  const activeAgents = agentList.filter((a) => a.alive).length;
  const availableProps = properties.filter((p) => !p.owner).length;

  // Header + tiles
  setText("hdr-gold", totalGold.toLocaleString());
  setText("hdr-diamonds", String(owned.filter((p) => p.def.tier >= 3).length));
  setText("hdr-tick", `tick ${tick}`);
  setText("hdr-tier", tierName(totalPassive));
  setText("tile-passive", totalPassive.toLocaleString());
  const trend = incomeTrend();
  setText("tile-passive-trend", `${trend >= 0 ? "+" : ""}${trend}%`);
  setText("tile-owned", String(owned.length));
  setText("tile-available", String(availableProps));
  setText("tile-agents", String(agentList.length));
  setText("tile-agents-active", String(activeAgents));
  setText("nav-prop-count", String(owned.length));
  setText("nav-agent-count", String(agentList.length));
  setText("bell-badge", String(owned.filter((p) => p.listedFor).length || activeAgents));

  renderProps(owned);
  renderSpark();
  renderDonut(owned);
  renderAgents(agentList);
}

function renderProps(owned: PropState[]) {
  const el = document.getElementById("prop-list")!;
  const top = [...owned].sort((a, b) => b.rentPerTick - a.rentPerTick).slice(0, 4);
  el.innerHTML = top
    .map((p, i) => {
      const t = p.def.tier;
      const tenants = Math.min(30, 12 + t * 5 + (i % 3));
      const maxTen = tenants + (t >= 4 ? 0 : 1 + (i % 3));
      return `
      <div class="prop-card ${i === 0 ? "featured" : ""}">
        <div class="prop-thumb t${t}">${TIER_EMOJI[t] || "🏠"}</div>
        <div class="prop-info">
          <div class="prop-head">
            <span class="prop-name">${esc(p.def.name)}</span>
            <span class="prop-tier-badge">Tier ${t}</span>
            <span class="prop-style">${TIER_STYLE[t] || "Estate"}</span>
          </div>
          <div class="prop-meta">
            Owner: <b>${esc(cap(p.ownerName || p.owner || "—"))}</b> &nbsp;·&nbsp;
            Zone: <b>${esc(zoneName(p.def.zone))}</b><br/>
            Income: <span class="gld">G ${p.rentPerTick}/tick</span> &nbsp;·&nbsp;
            Tenants: <b>${tenants}/${maxTen}</b>
          </div>
          <button class="manage-btn">Manage</button>
        </div>
      </div>`;
    })
    .join("") || `<div style="color:var(--text-dim);font-size:13px;padding:20px">No properties owned yet — agents are still accumulating gold.</div>`;
}

function renderSpark() {
  const svg = document.getElementById("spark")!;
  const data = incomeHistory.length ? incomeHistory : [0, 0, 0, 0, 0, 0, 0];
  const w = 260, h = 100, pad = 6;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / (data.length - 1 || 1);
    const y = h - pad - ((v - min) / range) * (h - pad * 2 - 14);
    return [x, y];
  });
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h - pad} L${pts[0][0].toFixed(1)},${h - pad} Z`;
  const days = ["-6", "-5", "-4", "-3", "-2", "-1", "now"];
  svg.innerHTML = `
    <defs>
      <linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#38e0d8" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#38e0d8" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${area}" fill="url(#sparkfill)"/>
    <path d="${line}" fill="none" stroke="#38e0d8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    ${pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2" fill="#38e0d8"/>`).join("")}
    ${days.map((d, i) => `<text class="axis-label" x="${pad + (i * (w - pad * 2)) / 6}" y="${h - 1}" text-anchor="middle">${d}</text>`).join("")}
  `;
}

function renderDonut(owned: PropState[]) {
  const byTier: Record<number, number> = {};
  for (const p of owned) byTier[p.def.tier] = (byTier[p.def.tier] || 0) + p.rentPerTick;
  const total = Object.values(byTier).reduce((s, v) => s + v, 0) || 1;
  const svg = document.getElementById("donut")!;
  const legend = document.getElementById("donut-legend")!;
  let offset = 25; // rotate start to top
  const seg: string[] = [];
  const leg: string[] = [];
  const tiers = Object.keys(byTier).map(Number).sort((a, b) => b - a);
  for (const t of tiers) {
    const pct = (byTier[t] / total) * 100;
    seg.push(
      `<circle cx="21" cy="21" r="15.9" fill="none" stroke="${TIER_COLOR[t]}" stroke-width="5"
        stroke-dasharray="${pct.toFixed(1)} ${(100 - pct).toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"/>`,
    );
    offset -= pct;
    leg.push(
      `<div class="legend-item"><span class="legend-dot" style="background:${TIER_COLOR[t]}"></span>
        <span class="legend-name">${TIER_INCOME_LABEL[t] || "Tier " + t}</span>
        <span class="legend-pct">${Math.round(pct)}%</span></div>`,
    );
  }
  svg.innerHTML =
    `<circle cx="21" cy="21" r="15.9" fill="none" stroke="rgba(120,200,210,0.06)" stroke-width="5"/>` +
    seg.join("");
  legend.innerHTML = leg.join("") || `<div class="legend-item"><span class="legend-name">No income yet</span></div>`;
}

function renderAgents(list: Agent[]) {
  const el = document.getElementById("agent-grid")!;
  const ranked = [...list].sort((a, b) => b.gold - a.gold);
  el.innerHTML = ranked
    .slice(0, 3)
    .map((a, i) => {
      const cls = agentClass(a.id);
      const rarity = RARITY_BY_CLASS[cls] || "rare";
      const pct = successPct(a);
      const crown = i === 0 ? "👑" : i === 1 ? "⭐" : "◆";
      const propCount = properties.filter((p) => p.owner === a.id).length;
      return `
      <div class="agent-card ${rarity}">
        <div class="agent-top">
          <div class="agent-avatar ${rarity}">${AVATAR[a.id] || AVATAR[cls] || "🧝"}</div>
          <div>
            <div class="agent-name">${esc(cap(a.id))}</div>
            <div class="agent-rarity ${rarity}">${cap(rarity)}</div>
          </div>
          <div class="agent-crown">${crown}</div>
        </div>
        <div class="agent-rows">
          <div class="agent-row"><span class="k">Class</span><span class="v">${cap(cls)}</span><span class="v rank">Rank ${i + 1}</span></div>
          <div class="agent-row"><span class="k">Gold</span><span class="v">${a.gold.toLocaleString()}g</span></div>
          <div class="agent-row"><span class="k">Level</span><span class="v">${a.level}</span></div>
          <div class="agent-row"><span class="k">Estates</span><span class="v">${propCount}</span></div>
          <div class="agent-row"><span class="k">Zone</span><span class="v">${esc(a.zone || "—")}</span></div>
        </div>
        <div class="agent-success">
          <div class="slabel"><span style="color:var(--text-dim)">Success</span><span class="spct" style="color:${TIER_COLOR[rarity === "legendary" ? 4 : rarity === "epic" ? 3 : 2]}">${pct}%</span></div>
          <div class="bar"><div class="fill ${rarity}" style="width:${pct}%"></div></div>
        </div>
        <button class="view-btn">View Portfolio</button>
      </div>`;
    })
    .join("");
}

// ── Small utils ──────────────────────────────────────────────
function setText(id: string, v: string) { const e = document.getElementById(id); if (e) e.textContent = v; }
function esc(s: string) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)); }
function cap(s: string) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function zoneName(z: string) { return cap(String(z).replace(/_/g, " ")); }
function tierName(passive: number): string {
  if (passive >= 300) return "Imperial";
  if (passive >= 150) return "Ascendant";
  if (passive >= 50) return "Established";
  return "Rising";
}
function incomeTrend(): number {
  if (incomeHistory.length < 2) return 0;
  const a = incomeHistory[incomeHistory.length - 2], b = incomeHistory[incomeHistory.length - 1];
  if (!a) return 0;
  return Math.round(((b - a) / a) * 100);
}

// ── Nav (visual only for now; Dashboard is the built view) ───
document.querySelectorAll<HTMLElement>(".nav-item").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    item.classList.add("active");
  });
});

// ── Connection status pill ───────────────────────────────────
function updateConn() {
  const label = document.getElementById("conn-label");
  if (!label) return;
  const live = gotLiveTick || gotLiveProps;
  label.textContent = live ? "LIVE" : "DEMO DATA";
}

// ── Boot ─────────────────────────────────────────────────────
seedSample();
render();
gameWS.connect(WS_URL);
fetchProperties().then(render);
fetchMesh().then(render);

setInterval(() => { fetchProperties(); fetchMesh(); }, 4000);
setInterval(() => { updateConn(); render(); }, 1000);
