/**
 * foxmqBridge.ts — FoxMQ ↔ Shard WebSocket Bridge
 *
 * Subscribes to the local FoxMQ broker on all wog/# topics and
 * forwards consensus-ordered messages to every connected browser client
 * via the existing WebSocket broadcaster.
 *
 * This makes the P2P agent mesh VISIBLE in the UI — judges can watch
 * the Tashi consensus ordering happen live without reading terminal logs.
 *
 * Starts automatically when FoxMQ is reachable; silently skips if not.
 */

import * as mqtt from "mqtt";
import { broadcaster } from "./wsEvents";

const FOXMQ_URL  = process.env.FOXMQ_URL  || "mqtt://127.0.0.1:1883";
const FOXMQ_USER = process.env.FOXMQ_USERNAME || "";
const FOXMQ_PASS = process.env.FOXMQ_PASSWORD || "";

// In-memory mesh state — tracks all known agents seen on FoxMQ
export interface MeshAgent {
  name:        string;
  cls:         string;
  hp:          number;
  maxHp:       number;
  gold:        number;
  level:       number;
  zone:        string | null;
  alive:       boolean;
  properties:  string[];
  passiveIncome: number;
  lastSeen:    number;     // ms timestamp
  status:      "active" | "stale";
}

// Ring buffer for recent FoxMQ messages (shown in Mesh panel)
export interface MeshMessage {
  seq:     number;
  ts:      number;
  topic:   string;
  sender:  string;
  summary: string;
  type:    "zone" | "quest" | "heal" | "loot" | "property" | "heartbeat" | "state";
}

const MAX_MSG_HISTORY = 50;
let msgSeq = 0;
const meshAgents = new Map<string, MeshAgent>();
const meshMessages: MeshMessage[] = [];

export function getMeshSnapshot() {
  const agents = [...meshAgents.values()];
  const staleThreshold = Date.now() - 15_000;
  // Mark stale
  for (const a of agents) {
    a.status = a.lastSeen < staleThreshold ? "stale" : "active";
  }
  return {
    connected: agents.filter(a => a.status === "active").length,
    agents,
    recentMessages: [...meshMessages].reverse().slice(0, 30),
  };
}

function summarize(topic: string, data: Record<string, unknown>): string {
  const agent = (data.agent as string) || "?";
  if (topic === "wog/heartbeat")        return `${agent} HP=${data.hp}/${data.maxHp} gold=${data.gold}g zone=${data.zone || "none"}`;
  if (topic === "wog/zone/claim")       return `${agent} claims zone [${data.zone}]`;
  if (topic === "wog/zone/yield")       return `${agent} yields zone [${data.zone}]`;
  if (topic === "wog/quest/claim")      return `${agent} takes quest [${data.quest}]`;
  if (topic === "wog/quest/abandon")    return `${agent} abandons [${data.quest}]`;
  if (topic === "wog/heal/request")     return `${agent} requests heal (${data.hp}/${data.maxHp} HP)`;
  if (topic === "wog/heal/response")    return `${agent} covers ${data.target}`;
  if (topic === "wog/loot/auction")     return `${agent} auctioning [${data.item}]`;
  if (topic === "wog/loot/bid")         return `${agent} bids ${data.gold}g on [${data.item}]`;
  if (topic === "wog/property/list")    return `${agent} lists [${data.name}] for ${data.price}g`;
  if (topic === "wog/property/offer")   return `${agent} offers ${data.offer}g for [${data.property_id}]`;
  if (topic === "wog/property/sold")    return `[${data.property_id}] sold: ${data.agent} -> ${data.buyer} @ ${data.price}g`;
  if (topic === "wog/property/distress") return `${agent} DISTRESS SALE — portfolio at 60%`;
  return `${agent}: ${JSON.stringify(data).slice(0, 80)}`;
}

function msgType(topic: string): MeshMessage["type"] {
  if (topic.startsWith("wog/zone"))     return "zone";
  if (topic.startsWith("wog/quest"))    return "quest";
  if (topic.startsWith("wog/heal"))     return "heal";
  if (topic.startsWith("wog/loot"))     return "loot";
  if (topic.startsWith("wog/property")) return "property";
  if (topic === "swarm/hello" || topic === "swarm/state") return "state";
  return "heartbeat";
}

export function startFoxmqBridge() {
  const client = mqtt.connect(FOXMQ_URL, {
    username:       FOXMQ_USER || undefined,
    password:       FOXMQ_PASS || undefined,
    reconnectPeriod: 5000,
    connectTimeout:  3000,
    clientId:       "wog-shard-bridge",
    clean:          true,
  });

  client.on("connect", () => {
    console.log(`[FoxMQ Bridge] Connected to ${FOXMQ_URL} — subscribing wog/#`);
    client.subscribe("wog/#", { qos: 1 });
    client.subscribe("swarm/#", { qos: 1 });
    broadcaster.emit({ type: "foxmq_status", data: { connected: true, url: FOXMQ_URL } });
  });

  client.on("error", (err) => {
    // Non-fatal — FoxMQ may not be running; bridge is optional
    if ((err as any).code === "ECONNREFUSED") {
      console.log("[FoxMQ Bridge] Not running — mesh panel will show offline state");
    }
  });

  client.on("offline", () => {
    broadcaster.emit({ type: "foxmq_status", data: { connected: false } });
  });

  client.on("message", (topic, payload) => {
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(payload.toString()); } catch { return; }

    const sender = (data.agent as string) || (data.id as string) || "unknown";

    // Update mesh agent state from heartbeats
    if (topic === "wog/heartbeat") {
      meshAgents.set(sender, {
        name:          sender,
        cls:           (data.cls as string) || "?",
        hp:            Number(data.hp) || 0,
        maxHp:         Number(data.max_hp) || 100,
        gold:          Number(data.gold) || 0,
        level:         Number(data.level) || 1,
        zone:          (data.zone as string) || null,
        alive:         Boolean(data.alive ?? true),
        properties:    (data.properties as string[]) || [],
        passiveIncome: Number(data.passive_income) || 0,
        lastSeen:      Date.now(),
        status:        "active",
      });
    }

    // Record message in ring buffer
    const msg: MeshMessage = {
      seq:     ++msgSeq,
      ts:      Date.now(),
      topic,
      sender,
      summary: summarize(topic, data),
      type:    msgType(topic),
    };
    meshMessages.push(msg);
    if (meshMessages.length > MAX_MSG_HISTORY) meshMessages.shift();

    // Forward to all browser clients (skip heartbeats — too noisy)
    if (topic !== "wog/heartbeat") {
      broadcaster.emit({ type: "foxmq_message", data: msg });
    } else {
      // Emit mesh state update for agent cards
      broadcaster.emit({ type: "foxmq_mesh", data: { agents: [...meshAgents.values()] } });
    }
  });

  return client;
}
