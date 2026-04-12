/**
 * foxmqBridge.ts — FoxMQ Consensus Backbone
 *
 * FoxMQ (Tashi Vertex) is the authoritative write path for:
 *   - Zone claims      wog/zone/claim|yield
 *   - Quest claims     wog/quest/claim|abandon
 *   - Property market  wog/property/offer|sold|list|distress
 *
 * The key property: FoxMQ guarantees every subscriber sees messages in the
 * SAME consensus order (BFT). So "first valid message wins" rules resolve
 * identically on every node — Node.js shard, Python agents, future clients —
 * without any coordinator.
 *
 * Write path:
 *   HTTP route   →  mqPublish(topic, payload)
 *   FoxMQ orders →  on("message") handler applies state
 *
 * Read path (display):
 *   heartbeats, mesh panel, WebSocket broadcast — unchanged from before.
 */

import * as mqtt from "mqtt";
import { broadcaster } from "./wsEvents";
import { applyFoxmqTransfer, applyFoxmqList, getProperty } from "./propertyMarket";

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

const FOXMQ_URL  = process.env.FOXMQ_URL       || "mqtt://127.0.0.1:1883";
const FOXMQ_USER = process.env.FOXMQ_USERNAME  || "";
const FOXMQ_PASS = process.env.FOXMQ_PASSWORD  || "";

// ─────────────────────────────────────────────────────────────
// CONSENSUS STATE  (mirrors what Python agents track locally)
// ─────────────────────────────────────────────────────────────

/** zone → agentId/playerId — who currently holds this zone */
export const zoneClaims = new Map<string, string>();

/** quest → agentId/playerId — who currently owns this quest task */
export const questClaims = new Map<string, string>();

/** propertyId → { buyerId, gold, seq } — pending first-offer tracking */
const pendingOffers = new Map<string, { buyerId: string; buyerName: string; gold: number; seq: number }>();

// ─────────────────────────────────────────────────────────────
// MESH DISPLAY STATE  (unchanged from old bridge)
// ─────────────────────────────────────────────────────────────

export interface MeshAgent {
  name:          string;
  cls:           string;
  hp:            number;
  maxHp:         number;
  gold:          number;
  level:         number;
  zone:          string | null;
  alive:         boolean;
  properties:    string[];
  passiveIncome: number;
  lastSeen:      number;
  status:        "active" | "stale";
}

export interface MeshMessage {
  seq:     number;
  ts:      number;
  topic:   string;
  sender:  string;
  summary: string;
  type:    "zone" | "quest" | "heal" | "loot" | "property" | "heartbeat" | "state";
}

const MAX_MSG_HISTORY = 50;
let   msgSeq = 0;
const meshAgents  = new Map<string, MeshAgent>();
const meshMessages: MeshMessage[] = [];

export function getMeshSnapshot() {
  const agents = [...meshAgents.values()];
  const staleThreshold = Date.now() - 15_000;
  for (const a of agents) a.status = a.lastSeen < staleThreshold ? "stale" : "active";
  return {
    connected:      agents.filter(a => a.status === "active").length,
    agents,
    recentMessages: [...meshMessages].reverse().slice(0, 30),
    zoneClaims:     Object.fromEntries(zoneClaims),
    questClaims:    Object.fromEntries(questClaims),
  };
}

// ─────────────────────────────────────────────────────────────
// MQTT CLIENT + PUBLISH HELPER
// ─────────────────────────────────────────────────────────────

let _client: mqtt.MqttClient | null = null;
let _pubSeq = 0;

/** Publish a game event to FoxMQ. Returns false if broker is not connected. */
export function mqPublish(topic: string, payload: Record<string, unknown>): boolean {
  if (!_client?.connected) return false;
  payload._seq = ++_pubSeq;
  payload._src = "shard";
  _client.publish(topic, JSON.stringify(payload), { qos: 1 });
  return true;
}

// ─────────────────────────────────────────────────────────────
// CONSENSUS HANDLERS  (all run in message-arrival order)
// ─────────────────────────────────────────────────────────────

function handleZoneClaim(sender: string, data: Record<string, unknown>, seq: number) {
  const zone = data.zone as string;
  if (!zone) return;

  if (!zoneClaims.has(zone)) {
    // First claim in consensus order wins — grant it
    zoneClaims.set(zone, sender);
    console.log(`[FoxMQ] ZONE GRANT  seq=${seq}: ${sender} → [${zone}]`);
    broadcaster.emit({ type: "zone_claimed", data: { zone, claimant: sender, seq } });
  } else {
    const current = zoneClaims.get(zone);
    if (current !== sender) {
      console.log(`[FoxMQ] ZONE REJECT seq=${seq}: ${sender} conflicts with ${current} on [${zone}] — ${current} holds`);
    }
  }
}

function handleZoneYield(sender: string, data: Record<string, unknown>) {
  const zone = data.zone as string;
  if (zone && zoneClaims.get(zone) === sender) {
    zoneClaims.delete(zone);
    console.log(`[FoxMQ] ZONE YIELD: ${sender} released [${zone}]`);
    broadcaster.emit({ type: "zone_yielded", data: { zone, agent: sender } });
  }
}

function handleQuestClaim(sender: string, data: Record<string, unknown>, seq: number) {
  const quest = data.quest as string;
  if (!quest) return;

  if (!questClaims.has(quest)) {
    questClaims.set(quest, sender);
    // Execute in the runtime quest system so the agent actually has the quest
    if (_acceptQuest) {
      const result = _acceptQuest(sender, quest);
      console.log(`[FoxMQ] QUEST GRANT  seq=${seq}: ${sender} → [${quest}] (accepted=${result.success})`);
    } else {
      console.log(`[FoxMQ] QUEST GRANT  seq=${seq}: ${sender} → [${quest}] (no runtime cb)`);
    }
    broadcaster.emit({ type: "quest_claimed", data: { quest, claimant: sender, seq } });
  } else {
    const current = questClaims.get(quest);
    if (current !== sender) {
      console.log(`[FoxMQ] QUEST REJECT seq=${seq}: ${sender} conflicts with ${current} — ${current} holds`);
    }
  }
}

function handleQuestAbandon(sender: string, data: Record<string, unknown>) {
  const quest = data.quest as string;
  if (!quest || questClaims.get(quest) !== sender) return;

  questClaims.delete(quest);
  if (_abandonQuest) _abandonQuest(sender, quest);
  console.log(`[FoxMQ] QUEST ABANDON: ${sender} dropped [${quest}]`);
  broadcaster.emit({ type: "quest_abandoned", data: { quest, agent: sender } });
}

// ─────────────────────────────────────────────────────────────
// QUEST CALLBACKS  (injected by server.ts at startup)
// ─────────────────────────────────────────────────────────────

let _acceptQuest:  ((playerId: string, questId: string) => { success: boolean; questName?: string }) | null = null;
let _abandonQuest: ((playerId: string, questId: string) => boolean) | null = null;

export function injectQuestCallbacks(
  accept:  (playerId: string, questId: string) => { success: boolean; questName?: string },
  abandon: (playerId: string, questId: string) => boolean,
) {
  _acceptQuest  = accept;
  _abandonQuest = abandon;
}

/**
 * Property offer — consensus-ordered first-valid-offer wins.
 *
 * When the shard receives a wog/property/offer it validates gold and applies
 * the transfer THEN publishes wog/property/sold. This mirrors what Python
 * agents do: seller accepts first offer → publishes sold → all nodes update.
 *
 * The shard is authoritative on gold balances, so it gates the offer here.
 * deductGold / awardGold are injected by server.ts at init time.
 */
let _deductGold: ((playerId: string, amount: number) => void)        | null = null;
let _awardGold:  ((playerId: string, amount: number) => void)        | null = null;
let _getGold:    ((playerId: string) => number | null)               | null = null;

export function injectGoldCallbacks(
  deduct: (playerId: string, amount: number) => void,
  award:  (playerId: string, amount: number) => void,
  get:    (playerId: string) => number | null,   // null = not a shard player, skip gold gate
) {
  _deductGold = deduct;
  _awardGold  = award;
  _getGold    = get;
}

function handlePropertyOffer(sender: string, data: Record<string, unknown>, seq: number) {
  const propertyId = data.property_id as string;
  const offer      = Number(data.offer)   || 0;
  const buyerName  = (data.buyer_name as string) || sender;

  if (!propertyId || offer <= 0) return;

  // Already have a pending offer for this property from an earlier seq — reject
  if (pendingOffers.has(propertyId)) {
    const existing = pendingOffers.get(propertyId)!;
    console.log(`[FoxMQ] OFFER REJECT seq=${seq}: ${sender} on [${propertyId}] — ${existing.buyerId} already offered @ seq=${existing.seq}`);
    return;
  }

  const prop = getProperty(propertyId);
  if (!prop) return;

  // Property must be available (unowned or listed)
  if (prop.owner && !prop.listedFor) {
    console.log(`[FoxMQ] OFFER REJECT seq=${seq}: [${propertyId}] not for sale`);
    return;
  }

  const price = prop.listedFor ?? prop.def.priceGold;
  if (offer < price) {
    console.log(`[FoxMQ] OFFER REJECT seq=${seq}: ${sender} offered ${offer}g < ${price}g ask`);
    return;
  }

  // Validate buyer has the gold — only for shard-registered players.
  // Python agents manage their own gold; _getGold returns null for unknown players.
  if (_getGold) {
    const gold = _getGold(sender);
    if (gold !== null && gold < price) {
      console.log(`[FoxMQ] OFFER REJECT seq=${seq}: ${sender} insufficient gold (need ${price}g, have ${gold}g)`);
      return;
    }
  }

  // Record as the winning offer
  pendingOffers.set(propertyId, { buyerId: sender, buyerName, gold: offer, seq });
  console.log(`[FoxMQ] OFFER ACCEPT seq=${seq}: ${sender} → [${propertyId}] @ ${offer}g — applying transfer`);

  // Apply the transfer in shard state
  const prevOwner = prop.owner;
  if (_deductGold) _deductGold(sender, price);
  if (prevOwner && _awardGold) _awardGold(prevOwner, price);

  applyFoxmqTransfer(propertyId, sender);
  pendingOffers.delete(propertyId);

  // Publish the settlement — all other nodes (Python agents etc.) will update their local state
  mqPublish("wog/property/sold", {
    agent:       "shard",
    buyer:       sender,
    buyer_name:  buyerName,
    seller:      prevOwner ?? "realm",
    property_id: propertyId,
    price,
    timestamp:   Date.now(),
  });

  broadcaster.emit({
    type: "property_sold",
    data: { propertyId, propertyName: prop.def.name, zone: prop.def.zone, buyer: buyerName, seller: prevOwner ?? "Realm", price },
  });
}

function handlePropertySold(sender: string, data: Record<string, unknown>) {
  // If it was published by us (shard), we already applied the state.
  // If it came from a Python agent selling to another Python agent, apply it here too.
  if (data._src === "shard") return;

  const propertyId = data.property_id as string;
  const buyer      = data.buyer as string;
  const price      = Number(data.price) || 0;
  // Python sold messages use `agent` as the seller, not a `seller` field.
  // Fall back to `sender` (= data.agent) when data.seller is absent.
  const prevOwner  = (data.seller as string | undefined) || (sender !== "realm" ? sender : undefined);

  if (!propertyId || !buyer) return;

  const prop = getProperty(propertyId);
  if (!prop) return;

  // Idempotency guard: skip only if buyer is already the owner (sale already applied)
  if (prop.owner === buyer) {
    console.log(`[FoxMQ] SOLD SKIP: [${propertyId}] already owned by ${buyer}`);
    return;
  }

  if (prevOwner && _awardGold) _awardGold(prevOwner, price);
  if (_deductGold) _deductGold(buyer, price);
  applyFoxmqTransfer(propertyId, buyer);
  console.log(`[FoxMQ] SOLD (external): [${propertyId}] → ${buyer} @ ${price}g (seller=${prevOwner ?? "realm"})`);

  broadcaster.emit({
    type: "property_sold",
    data: { propertyId, propertyName: prop.def.name, buyer, seller: prevOwner ?? "Realm", price },
  });
}

function handlePropertyList(sender: string, data: Record<string, unknown>) {
  const propertyId = data.property_id as string;
  const price      = Number(data.price) || 0;
  if (!propertyId || price <= 0) return;

  const prop = getProperty(propertyId);
  if (!prop || prop.owner !== sender) return;

  applyFoxmqList(propertyId, price);
  console.log(`[FoxMQ] LISTED: [${propertyId}] @ ${price}g by ${sender}`);
  broadcaster.emit({ type: "property_listed", data: { propertyId, name: prop.def.name, price, zone: prop.def.zone } });
}

function handlePropertyDistress(sender: string, data: Record<string, unknown>) {
  const propertyIds = (data.properties as string[]) || [];
  console.log(`[FoxMQ] DISTRESS: ${sender} emergency-auctioning ${propertyIds.length} properties`);

  for (const pid of propertyIds) {
    const prop = getProperty(pid);
    if (!prop || prop.owner !== sender) continue;
    const distressPrice = Math.floor(prop.def.priceGold * 0.6);
    applyFoxmqList(pid, distressPrice);
    console.log(`[FoxMQ]   Distress listing [${prop.def.name}] @ ${distressPrice}g (60%)`);
    broadcaster.emit({ type: "property_distress", data: { propertyId: pid, name: prop.def.name, price: distressPrice, seller: sender } });
  }
}

// ─────────────────────────────────────────────────────────────
// DISPLAY HELPERS  (unchanged)
// ─────────────────────────────────────────────────────────────

function summarize(topic: string, data: Record<string, unknown>): string {
  const a = (data.agent as string) || (data._src as string) || "?";
  if (topic === "wog/heartbeat")          return `${a} HP=${data.hp}/${data.max_hp} gold=${data.gold}g zone=${data.zone ?? "—"}`;
  if (topic === "wog/zone/claim")         return `${a} claims zone [${data.zone}]`;
  if (topic === "wog/zone/yield")         return `${a} yields zone [${data.zone}]`;
  if (topic === "wog/quest/claim")        return `${a} takes quest [${data.quest}]`;
  if (topic === "wog/quest/abandon")      return `${a} drops [${data.quest}]`;
  if (topic === "wog/heal/request")       return `${a} requests heal (${data.hp}/${data.max_hp} HP)`;
  if (topic === "wog/heal/response")      return `${a} covers ${data.target}`;
  if (topic === "wog/loot/auction")       return `${a} auctioning [${data.item}]`;
  if (topic === "wog/loot/bid")           return `${a} bids ${data.gold}g on [${data.item}]`;
  if (topic === "wog/property/list")      return `${a} lists [${data.name}] @ ${data.price}g`;
  if (topic === "wog/property/offer")     return `${a} offers ${data.offer}g for [${data.property_id}]`;
  if (topic === "wog/property/sold")      return `[${data.property_id}] sold → ${data.buyer} @ ${data.price}g`;
  if (topic === "wog/property/distress")  return `${a} DISTRESS SALE — portfolio at 60%`;
  return `${a}: ${JSON.stringify(data).slice(0, 80)}`;
}

function msgType(topic: string): MeshMessage["type"] {
  if (topic.startsWith("wog/zone"))      return "zone";
  if (topic.startsWith("wog/quest"))     return "quest";
  if (topic.startsWith("wog/heal"))      return "heal";
  if (topic.startsWith("wog/loot"))      return "loot";
  if (topic.startsWith("wog/property"))  return "property";
  if (topic === "swarm/hello" || topic === "swarm/state") return "state";
  return "heartbeat";
}

// ─────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────

export function startFoxmqBridge() {
  const client = mqtt.connect(FOXMQ_URL, {
    username:        FOXMQ_USER || undefined,
    password:        FOXMQ_PASS || undefined,
    reconnectPeriod: 5000,
    connectTimeout:  3000,
    clientId:        "wog-shard-bridge",
    clean:           true,
  });

  _client = client;

  client.on("connect", () => {
    console.log(`[FoxMQ Bridge] Connected to ${FOXMQ_URL} — subscribing wog/# swarm/#`);
    client.subscribe("wog/#",   { qos: 1 });
    client.subscribe("swarm/#", { qos: 1 });
    broadcaster.emit({ type: "foxmq_status", data: { connected: true, url: FOXMQ_URL } });
  });

  client.on("error", (err) => {
    if ((err as any).code === "ECONNREFUSED") {
      console.log("[FoxMQ Bridge] Broker not running — zone/quest/property via FoxMQ disabled");
    }
  });

  client.on("offline", () => {
    _client = null;
    broadcaster.emit({ type: "foxmq_status", data: { connected: false } });
  });

  client.on("reconnect", () => {
    _client = client;
  });

  client.on("message", (topic, payload) => {
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(payload.toString()); } catch { return; }

    const sender = (data.agent as string) || (data.id as string) || (data.buyer as string) || "unknown";
    const seq    = Number(data.seq ?? data._seq ?? 0);

    // ── Consensus write handlers ───────────────────────────
    if (topic === "wog/zone/claim")        handleZoneClaim(sender, data, seq);
    else if (topic === "wog/zone/yield")   handleZoneYield(sender, data);
    else if (topic === "wog/quest/claim")  handleQuestClaim(sender, data, seq);
    else if (topic === "wog/quest/abandon")handleQuestAbandon(sender, data);
    else if (topic === "wog/property/offer")  handlePropertyOffer(sender, data, seq);
    else if (topic === "wog/property/sold")   handlePropertySold(sender, data);
    else if (topic === "wog/property/list")   handlePropertyList(sender, data);
    else if (topic === "wog/property/distress") handlePropertyDistress(sender, data);

    // ── Mesh display state ─────────────────────────────────
    if (topic === "wog/heartbeat") {
      meshAgents.set(sender, {
        name:          sender,
        cls:           (data.cls as string)      || "?",
        hp:            Number(data.hp)           || 0,
        maxHp:         Number(data.max_hp)       || 100,
        gold:          Number(data.gold)         || 0,
        level:         Number(data.level)        || 1,
        zone:          (data.zone as string)     || null,
        alive:         Boolean(data.alive ?? true),
        properties:    (data.properties as string[]) || [],
        passiveIncome: Number(data.passive_income) || 0,
        lastSeen:      Date.now(),
        status:        "active",
      });
    }

    // ── Ring buffer for display ────────────────────────────
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

    // Forward to browser clients
    if (topic !== "wog/heartbeat") {
      broadcaster.emit({ type: "foxmq_message", data: msg });
    } else {
      broadcaster.emit({ type: "foxmq_mesh", data: { agents: [...meshAgents.values()] } });
    }
  });

  return client;
}
