/**
 * wsEvents.ts — WebSocket Event Broadcaster
 * Adds real-time push to the shard server.
 * Frontend receives live combat hits, deaths, level ups, quest completions.
 */

import { FastifyInstance } from "fastify";
import { ZoneRuntime } from "./zoneRuntime";

// ============================================================
// EVENT TYPES
// ============================================================

export type GameEvent =
  // ── Core game events ───────────────────────────────────────
  | { type: "combat_hit";       data: { playerId: string; playerName: string; mobId: string; mobName: string; damage: number; crit: boolean; mobHp: number; mobMaxHp: number } }
  | { type: "mob_died";         data: { mobId: string; mobName: string; zone: string; xpGained: number; goldDropped: number; loot: string[] } }
  | { type: "player_died";      data: { playerId: string; playerName: string; zone: string; deathCount: number } }
  | { type: "player_respawned"; data: { playerId: string; playerName: string; zone: string } }
  | { type: "player_levelup";   data: { playerId: string; playerName: string; newLevel: number; zone: string } }
  | { type: "quest_accepted";   data: { playerId: string; playerName: string; questName: string } }
  | { type: "quest_completed";  data: { playerId: string; playerName: string; questName: string; goldReward: number; xpReward: number } }
  | { type: "zone_transition";  data: { playerId: string; playerName: string; fromZone: string; toZone: string } }
  | { type: "agent_decision";   data: { playerId: string; playerName: string; action: string; target: string; reasoning: string } }
  | { type: "tick";             data: WorldSnapshot }
  // ── FoxMQ consensus events ─────────────────────────────────
  | { type: "zone_claimed";      data: { zone: string; claimant: string; seq: number } }
  | { type: "zone_yielded";      data: { zone: string; agent: string } }
  | { type: "quest_claimed";     data: { quest: string; claimant: string; seq: number } }
  | { type: "quest_abandoned";   data: { quest: string; agent: string } }
  | { type: "property_sold";     data: { propertyId: string; propertyName?: string; zone?: string; buyer: string; seller: string; price: number } }
  | { type: "property_listed";   data: { propertyId: string; name: string; price: number; zone: string } }
  | { type: "property_distress"; data: { propertyId: string; name: string; price: number; seller: string } }
  // ── FoxMQ mesh / infra events ──────────────────────────────
  | { type: "foxmq_status";  data: { connected: boolean; url?: string } }
  | { type: "foxmq_message"; data: Record<string, unknown> }
  | { type: "foxmq_mesh";    data: { agents: unknown[] } };

export interface WorldSnapshot {
  timestamp: number;
  zones: ZoneSnapshot[];
  agents: AgentSnapshot[];
}

export interface ZoneSnapshot {
  id: string;
  name: string;
  players: { id: string; name: string; class: string; level: number; hp: number; maxHp: number; x: number; y: number }[];
  mobs:    { id: string; name: string; level: number; hp: number; maxHp: number; x: number; y: number; alive: boolean }[];
}

export interface AgentSnapshot {
  id: string; name: string; class: string; level: number;
  xp: number; hp: number; maxHp: number; zone: string;
  x: number; y: number;
  questsCompleted: number; lastAction: string;
}

// ============================================================
// BROADCASTER CLASS
// ============================================================

export class WSBroadcaster {
  private clients: Set<any> = new Set();
  private runtime: ZoneRuntime;
  private server: FastifyInstance;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  public eventQueue: GameEvent[] = [];

  constructor(server: FastifyInstance, runtime: ZoneRuntime) {
    this.server = server;
    this.runtime = runtime;
  }

  start(): void {
    (this.server as any).get("/ws", { websocket: true }, (socket: any) => {
      this.clients.add(socket);
      console.log(`🔌 Spectator connected (total: ${this.clients.size})`);

      // Send full world state on connect
      socket.send(JSON.stringify({ type: "tick", data: this.buildSnapshot() }));

      socket.on("close", () => {
        this.clients.delete(socket);
        console.log(`🔌 Spectator disconnected (total: ${this.clients.size})`);
      });
      socket.on("error", () => this.clients.delete(socket));
    });

    // Flush events + send snapshot every 500ms
    this.tickInterval = setInterval(() => {
      if (this.clients.size === 0) return;
      for (const event of this.eventQueue) this.broadcast(event);
      this.eventQueue = [];
      this.broadcast({ type: "tick", data: this.buildSnapshot() });
    }, 500);

    console.log("📡 WebSocket broadcaster ready → ws://localhost:3000/ws");
  }

  emit(event: GameEvent): void {
    this.eventQueue.push(event);
  }

  private broadcast(event: GameEvent): void {
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      try {
        if (client.readyState === 1) client.send(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  private buildSnapshot(): WorldSnapshot {
    const { ZONES, MOB_TEMPLATES } = require("./worldData");
    const zones: ZoneSnapshot[] = [];

    for (const [zoneId, zone] of this.runtime.zones.entries()) {
      zones.push({
        id: zoneId,
        name: ZONES[zoneId]?.name || zoneId,
        players: [...zone.players.values()].map(p => ({
          id: p.id, name: p.name, class: p.class, level: p.level,
          hp: p.currentHp, maxHp: p.maxHp,
          x: Math.round(p.position.x), y: Math.round(p.position.y),
        })),
        mobs: [...zone.mobs.values()].map(m => ({
          id: m.id, name: MOB_TEMPLATES[m.templateId]?.name || m.templateId,
          level: MOB_TEMPLATES[m.templateId]?.level || 1,
          hp: m.currentHp, maxHp: m.maxHp,
          x: Math.round(m.position.x), y: Math.round(m.position.y),
          alive: !m.deadUntil,
        })),
      });
    }

    const agents: AgentSnapshot[] = [...this.runtime.players.values()].map(p => ({
      id: p.id, name: p.name, class: p.class, level: p.level,
      xp: p.xp, hp: p.currentHp, maxHp: p.maxHp, zone: p.zone,
      x: Math.round(p.position.x), y: Math.round(p.position.y),
      questsCompleted: 0, lastAction: "",
    }));

    return { timestamp: Date.now(), zones, agents };
  }

  stop(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }
}

// ============================================================
// SIMPLE BROADCASTER — singleton used by server.ts
// server.ts imports { broadcaster } and calls:
//   broadcaster.addClient(ws)
//   broadcaster.emit(event)
//   broadcaster.tick(snapshot)
//   broadcaster.spectatorCount
// ============================================================

import type { WebSocket } from "ws";

export class SimpleBroadcaster {
  private clients: Set<WebSocket> = new Set();
  private history: GameEvent[] = [];

  get spectatorCount(): number { return this.clients.size; }

  addClient(ws: WebSocket): void {
    this.clients.add(ws);
    // Send last 50 events so new spectators aren't blank
    if (this.history.length > 0) {
      ws.send(JSON.stringify({ type: "history", events: this.history.slice(-50) }));
    }
    ws.on("close", () => this.clients.delete(ws));
    ws.on("error", () => this.clients.delete(ws));
    console.log(`👁  Spectator connected (${this.clients.size} watching)`);
  }

  emit(event: GameEvent): void {
    this.history.push(event);
    if (this.history.length > 200) this.history.shift();
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      if ((client as any).readyState === 1) client.send(payload);
    }
  }

  tick(snapshot: WorldSnapshot): void {
    // Broadcast a full world snapshot every tick
    const event: GameEvent = { type: "tick", data: snapshot };
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      if ((client as any).readyState === 1) client.send(payload);
    }
  }
}

export const broadcaster = new SimpleBroadcaster();
