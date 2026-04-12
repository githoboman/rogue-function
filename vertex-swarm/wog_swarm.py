"""
Vertex Swarm Challenge 2026 — Track 3: The Agent Economy
World of Guilds: Leaderless P2P Agent Coordination via Tashi FoxMQ

Three autonomous AI agents (Ragnar, Lyria, Kira) coordinate without any
central orchestrator. Zone claims, healing requests, quest handoffs, and
loot auctions are all resolved through FoxMQ consensus-ordered messaging.

Architecture:
  - No master controller. No shared memory. No central server.
  - Every coordination decision flows through FoxMQ topics.
  - FoxMQ (Tashi Vertex) guarantees all agents see messages in the SAME order
    → deterministic conflict resolution without a coordinator.

Decision engine: Utility AI
  Each possible action is scored 0.0–1.0 based on current state.
  Personality weights shift those scores per agent. Highest score wins.
  Action cooldowns prevent spam. Short-term memory tracks outcomes.

FSM lifecycle:
  ACTIVE → LOW_HP → RETREATING → DEAD → RESPAWNING → ACTIVE

Topics:
  wog/heartbeat           - agent state broadcast (HP, gold, zone, level, properties)
  wog/zone/claim          - claim exclusive rights to a grinding zone
  wog/zone/yield          - release a zone (on death or retreat)
  wog/quest/claim         - claim a quest task
  wog/quest/abandon       - abandon quest (hand off to peers)
  wog/heal/request        - broadcast low-HP alert, request peer support
  wog/heal/response       - healthy agent offers to tank while requester heals
  wog/loot/auction        - announce rare item drop, open bidding
  wog/loot/bid            - agent bids on item with gold offer
  wog/property/list       - agent lists owned property for P2P sale
  wog/property/offer      - peer makes direct offer on a listed property
  wog/property/sold       - property sale confirmed (consensus-ordered settlement)
  wog/property/distress   - agent died, portfolio going to emergency auction

Run:
  python wog_swarm.py              # all 3 agents in one terminal (threaded)
  python wog_swarm.py ragnar       # single agent (run 3 separate terminals)
"""

import sys
import json
import time
import random
import threading
from collections import deque
from enum import Enum, auto
import paho.mqtt.client as mqtt
from paho.mqtt.enums import MQTTProtocolVersion

# Windows terminal UTF-8 fix
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

BROKER_HOST   = "localhost"
BROKER_PORT   = 1883
TICK_SEC      = 3      # decision tick
HEARTBEAT_SEC = 2      # state broadcast interval
STALE_SEC     = 10     # peer considered inactive after this silence

# ── World constants ──────────────────────────────────────────────────────────

ZONES = ["Forest", "Dungeon", "Volcano", "Glacier", "Abyss"]
QUESTS = [
    "Slay 10 Goblins", "Deliver Herbs", "Escort Merchant",
    "Collect Dragon Scales", "Scout the Ruins", "Defend the Gate",
]
RARE_ITEMS = ["Flame Sword", "Shadow Cloak", "Arcane Staff", "Iron Shield"]

ZONE_GOLD_PER_TICK = {"Forest": 8,  "Dungeon": 15, "Volcano": 22, "Glacier": 30, "Abyss": 45}
ZONE_DANGER        = {"Forest": 10, "Dungeon": 18, "Volcano": 28, "Glacier": 38, "Abyss": 55}
ZONE_MIN_LEVEL     = {"Forest": 1,  "Dungeon": 3,  "Volcano": 5,  "Glacier": 7,  "Abyss": 10}

PROPERTY_CATALOG = [
    {"id": "forest_cottage_1",  "name": "Ranger's Cabin",       "zone": "Forest",  "tier": 1, "price": 200,   "rent_per_tick": 4},
    {"id": "forest_house_1",    "name": "Huntsman's Lodge",      "zone": "Forest",  "tier": 2, "price": 500,   "rent_per_tick": 9},
    {"id": "forest_manor_1",    "name": "Forest Warden's Manor", "zone": "Forest",  "tier": 3, "price": 1200,  "rent_per_tick": 22},
    {"id": "dungeon_house_1",   "name": "Dungeon Keeper's Den",  "zone": "Dungeon", "tier": 2, "price": 700,   "rent_per_tick": 14},
    {"id": "dungeon_manor_1",   "name": "Crypt Lord's Estate",   "zone": "Dungeon", "tier": 3, "price": 1800,  "rent_per_tick": 35},
    {"id": "volcano_manor_1",   "name": "Ember Keep",            "zone": "Volcano", "tier": 3, "price": 3000,  "rent_per_tick": 58},
    {"id": "glacier_castle_1",  "name": "Frostgate Castle",      "zone": "Glacier", "tier": 4, "price": 6000,  "rent_per_tick": 120},
    {"id": "abyss_palace_1",    "name": "Abyssal Palace",        "zone": "Abyss",   "tier": 5, "price": 12000, "rent_per_tick": 250},
]
PROPERTY_BY_ID   = {p["id"]: p for p in PROPERTY_CATALOG}
PROPERTIES_BY_ZONE = {}
for _p in PROPERTY_CATALOG:
    PROPERTIES_BY_ZONE.setdefault(_p["zone"], []).append(_p)

# ── Personalities: weights shift utility scores per agent ────────────────────
#
# weight > 1.0  → agent scores this action higher than baseline
# weight < 1.0  → agent deprioritises this action
# Weights multiply the raw 0.0–1.0 utility score before comparison.

PERSONALITIES = {
    "ragnar": {
        "class": "Warrior", "emoji": "⚔️",
        "max_hp": 200, "atk": 25, "def_": 15,
        "max_properties": 3,
        "weights": {
            "grind":           1.5,   # loves combat, pushes hard zones
            "claim_zone":      1.3,
            "claim_quest":     0.5,   # quests are secondary
            "heal_self":       0.6,   # tough — heals late
            "request_heal":    0.4,
            "buy_potion":      0.7,
            "invest_property": 0.8,   # saves gold for dominance
            "list_property":   0.5,   # reluctant to sell
        },
    },
    "lyria": {
        "class": "Mage", "emoji": "🔮",
        "max_hp": 120, "atk": 40, "def_": 5,
        "max_properties": 4,
        "weights": {
            "grind":           0.7,   # safer zones, lower risk
            "claim_zone":      0.8,
            "claim_quest":     1.1,
            "heal_self":       1.5,   # heals aggressively (low HP pool)
            "request_heal":    1.2,
            "buy_potion":      1.4,   # stockpiles potions
            "invest_property": 1.3,   # builds passive income empire
            "list_property":   1.0,
        },
    },
    "kira": {
        "class": "Ranger", "emoji": "🏹",
        "max_hp": 150, "atk": 30, "def_": 10,
        "max_properties": 3,
        "weights": {
            "grind":           1.0,
            "claim_zone":      1.0,
            "claim_quest":     1.6,   # quest-focused for XP
            "heal_self":       1.0,
            "request_heal":    0.8,
            "buy_potion":      1.0,
            "invest_property": 0.9,
            "list_property":   1.2,   # opportunistic seller
        },
    },
}

# ── FSM states ───────────────────────────────────────────────────────────────

class FSMState(Enum):
    ACTIVE      = auto()   # full decision capability
    LOW_HP      = auto()   # healing priority; no zone pushes
    RETREATING  = auto()   # yielding zone and quest; moving safe
    DEAD        = auto()   # waiting for respawn timer
    RESPAWNING  = auto()   # transitioning back to ACTIVE

# ── Helpers ──────────────────────────────────────────────────────────────────

def now_ms() -> int:
    return int(time.time() * 1000)

_pub_seq = 0
def publish_json(client, topic: str, payload: dict, qos: int = 1):
    global _pub_seq
    _pub_seq += 1
    payload["seq"] = _pub_seq
    client.publish(topic, json.dumps(payload), qos=qos)

def fmt_hp(hp: int, max_hp: int) -> str:
    pct = hp / max_hp
    bar = "█" * int(pct * 10) + "░" * (10 - int(pct * 10))
    return f"[{bar}] {hp}/{max_hp} ({pct*100:.0f}%)"

def clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


# ════════════════════════════════════════════════════════════════════════════
class WoGAgent:
    """
    Autonomous WoG agent with:
      - Utility AI decision engine (scored actions, personality weights)
      - Explicit FSM lifecycle (ACTIVE / LOW_HP / RETREATING / DEAD / RESPAWNING)
      - Short-term action memory (tracks recent decisions and outcomes)
      - Per-zone performance learning (actual gold earned vs. expected)
      - Peer-aware decisions (use peer heartbeat data to avoid conflicts)
      - Action cooldowns (prevent spam on the same action each tick)
    """

    def __init__(self, name: str):
        p = PERSONALITIES[name]
        self.name          = name
        self.cls           = p["class"]
        self.emoji         = p["emoji"]
        self.weights       = p["weights"]
        self.max_hp        = p["max_hp"]
        self.atk           = p["atk"]
        self.def_          = p["def_"]
        self.max_properties = p["max_properties"]

        # Derived thresholds from weights (higher heal weight → heals earlier)
        self.heal_thr    = clamp(0.55 - 0.15 * (self.weights.get("heal_self", 1.0) - 1.0))
        self.retreat_thr = clamp(self.heal_thr * 0.5)

        # ── Core stats ───────────────────────────────────────
        self.hp      = self.max_hp
        self.gold    = 50
        self.level   = 1
        self.xp      = 0
        self.potions = 2
        self.zone    = None   # currently held zone
        self.quest   = None   # currently held quest

        # ── FSM ──────────────────────────────────────────────
        self.state       = FSMState.ACTIVE
        self.respawn_at  = 0

        # ── Memory ───────────────────────────────────────────
        # deque of (action_name, outcome_tag, timestamp_ms)
        self.action_log: deque = deque(maxlen=20)
        # zone → list of actual gold earned last N ticks (for learning)
        self.zone_perf: dict   = {z: [] for z in ZONES}
        # action → earliest time it can fire again
        self.cooldowns: dict   = {}

        # ── Properties ───────────────────────────────────────
        self.owned_properties = {}   # property_id → catalog entry
        self.passive_income   = 0

        # ── P2P coordination state ────────────────────────────
        self.peers          = {}   # name → last heartbeat payload + meta
        self.zone_claims    = {}   # zone → agent_name (FoxMQ consensus copy)
        self.quest_claims   = {}   # quest → agent_name
        self.pending_bids   = {}   # item → {bidder: gold}
        self.property_market = {}  # property_id → {seller, price, ts}
        self.heal_cover_by  = None # peer who offered to cover our heal

        self.lock = threading.Lock()

        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=name,
            protocol=MQTTProtocolVersion.MQTTv5,
        )
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message

    # ═══════════════════════════════════════════════════════════════════
    # MQTT
    # ═══════════════════════════════════════════════════════════════════

    def _on_connect(self, client, _userdata, _flags, _rc, _props):
        print(f"\n{self.emoji} [{self.name.upper()}] Connected to FoxMQ consensus mesh")
        client.subscribe("wog/#", qos=1)
        self._broadcast_state()

    def _on_message(self, _client, _userdata, msg):
        try:
            data = json.loads(msg.payload)
        except Exception:
            return
        sender = data.get("agent")
        if not sender or sender == self.name:
            return
        topic = msg.topic
        with self.lock:
            dispatch = {
                "wog/heartbeat":         self._handle_heartbeat,
                "wog/zone/claim":        self._handle_zone_claim,
                "wog/zone/yield":        self._handle_zone_yield,
                "wog/quest/claim":       self._handle_quest_claim,
                "wog/quest/abandon":     self._handle_quest_abandon,
                "wog/heal/request":      self._handle_heal_request,
                "wog/heal/response":     self._handle_heal_response,
                "wog/loot/auction":      self._handle_auction,
                "wog/loot/bid":          self._handle_bid,
                "wog/property/list":     self._handle_property_list,
                "wog/property/offer":    self._handle_property_offer,
                "wog/property/sold":     self._handle_property_sold,
                "wog/property/distress": self._handle_property_distress,
            }
            if topic in dispatch:
                dispatch[topic](sender, data)

    # ═══════════════════════════════════════════════════════════════════
    # MESSAGE HANDLERS  (all called under self.lock)
    # ═══════════════════════════════════════════════════════════════════

    def _handle_heartbeat(self, sender, data):
        was_stale = self.peers.get(sender, {}).get("stale", False)
        self.peers[sender] = {**data, "stale": False, "last_seen": now_ms()}
        if was_stale:
            print(f"  {self.emoji} [{self.name}] 🔄 Peer RECOVERED: {sender}")
            for zone, owner in list(self.zone_claims.items()):
                if owner == sender:
                    del self.zone_claims[zone]

    def _handle_zone_claim(self, sender, data):
        zone = data.get("zone", "")
        seq  = data.get("seq", "?")
        if zone not in self.zone_claims:
            self.zone_claims[zone] = sender
            print(f"  [{self.name}] CONSENSUS ZONE GRANT  seq={seq}: {sender} → [{zone}]")
        elif self.zone_claims[zone] != sender:
            print(f"  [{self.name}] CONSENSUS ZONE REJECT seq={seq}: {sender} conflicts with {self.zone_claims[zone]} on [{zone}] — {self.zone_claims[zone]} WINS")

    def _handle_zone_yield(self, sender, data):
        zone = data.get("zone", "")
        if self.zone_claims.get(zone) == sender:
            del self.zone_claims[zone]
            print(f"  {self.emoji} [{self.name}] 🏳️  {sender} yielded [{zone}] — zone open")

    def _handle_quest_claim(self, sender, data):
        quest = data.get("quest", "")
        seq   = data.get("seq", "?")
        if quest not in self.quest_claims:
            self.quest_claims[quest] = sender
            print(f"  [{self.name}] CONSENSUS QUEST GRANT  seq={seq}: {sender} → [{quest}]")
        elif self.quest_claims[quest] != sender:
            print(f"  [{self.name}] CONSENSUS QUEST REJECT seq={seq}: {sender} conflicts — {self.quest_claims[quest]} WINS")

    def _handle_quest_abandon(self, sender, data):
        quest = data.get("quest", "")
        if self.quest_claims.get(quest) == sender:
            del self.quest_claims[quest]
            print(f"  {self.emoji} [{self.name}] ❌ {sender} abandoned [{quest}] — open for pickup")
            # Opportunistically score a quest claim immediately on next tick

    def _handle_heal_request(self, sender, _data):
        my_hp_pct = self.hp / self.max_hp
        # Only respond if we're healthy enough and alive
        if my_hp_pct > 0.70 and self.state == FSMState.ACTIVE:
            print(f"  {self.emoji} [{self.name}] 💊 Offering heal cover to {sender}")
            publish_json(self.client, "wog/heal/response", {
                "agent": self.name, "target": sender,
                "timestamp": now_ms(), "coverage": "tanking",
                "my_hp_pct": round(my_hp_pct, 2),
            })

    def _handle_heal_response(self, sender, data):
        if data.get("target") == self.name:
            self.heal_cover_by = sender
            print(f"  {self.emoji} [{self.name}] 🛡️  {sender} covering (HP={data.get('my_hp_pct',0)*100:.0f}%) — using potion safely")

    def _handle_auction(self, _sender, data):
        item = data.get("item", "")
        desired = {"Warrior": "Iron Shield", "Mage": "Arcane Staff", "Ranger": "Shadow Cloak"}.get(self.cls)
        if self.gold < 10:
            return
        bid = min(self.gold // 4, 30)
        if item == desired:
            bid = min(self.gold // 2, 70)   # bid hard for preferred item
        if bid > 0:
            print(f"  {self.emoji} [{self.name}] 💰 Bidding {bid}g on [{item}]")
            publish_json(self.client, "wog/loot/bid", {
                "agent": self.name, "item": item, "gold": bid, "timestamp": now_ms(),
            })

    def _handle_bid(self, sender, data):
        item = data.get("item", "")
        self.pending_bids.setdefault(item, {})[sender] = data.get("gold", 0)

    def _handle_property_list(self, sender, data):
        pid   = data.get("property_id", "")
        price = data.get("price", 0)
        self.property_market[pid] = {"seller": sender, "price": price, "ts": data.get("timestamp", now_ms())}
        print(f"  [{self.name}] Market: {sender} listed [{data.get('name', pid)}] for {price}g")
        # Make an offer if affordable and not already owned
        prop = PROPERTY_BY_ID.get(pid)
        if prop and pid not in self.owned_properties and self.gold >= price:
            roi = prop["rent_per_tick"] / prop["price"]
            surplus = (self.gold - price) / max(self.gold, 1)
            # Only bid if ROI is decent and we still have comfortable gold after
            if roi > 0.015 and surplus > 0.30 and random.random() < 0.60:
                print(f"  [{self.name}] Placing offer on [{data.get('name', pid)}] @ {price}g (ROI={roi:.3f})")
                publish_json(self.client, "wog/property/offer", {
                    "agent": self.name, "property_id": pid, "offer": price, "timestamp": now_ms(),
                })

    def _handle_property_offer(self, sender, data):
        pid   = data.get("property_id", "")
        offer = data.get("offer", 0)
        seq   = data.get("seq", "?")
        # Accept first valid offer on listed property we own
        if pid in self.owned_properties and pid in self.property_market:
            listing = self.property_market[pid]
            if listing.get("seller") == self.name and offer >= listing["price"]:
                prop_name = PROPERTY_BY_ID.get(pid, {}).get("name", pid)
                print(f"  [{self.name}] CONSENSUS PROPERTY SOLD seq={seq}: [{prop_name}] → {sender} @ {offer}g")
                publish_json(self.client, "wog/property/sold", {
                    "agent": self.name, "buyer": sender,
                    "property_id": pid, "price": offer, "timestamp": now_ms(),
                })
                self.gold += offer
                del self.owned_properties[pid]
                self._recalc_passive_income()
                self.property_market.pop(pid, None)

    def _handle_property_sold(self, _sender, data):
        pid   = data.get("property_id", "")
        buyer = data.get("buyer", "")
        price = data.get("price", 0)
        prop  = PROPERTY_BY_ID.get(pid, {})
        print(f"  [{self.name}] SOLD: [{prop.get('name', pid)}] → {buyer} @ {price}g")
        if buyer == self.name:
            self.owned_properties[pid] = prop
            self.gold -= price
            self._recalc_passive_income()
            print(f"  [{self.name}] Portfolio: {len(self.owned_properties)} props, +{self.passive_income}g/tick passive")
        self.property_market.pop(pid, None)

    def _handle_property_distress(self, sender, data):
        for pid in data.get("properties", []):
            prop = PROPERTY_BY_ID.get(pid)
            if not prop:
                continue
            distress_price = int(prop["price"] * 0.6)
            self.property_market[pid] = {"seller": sender, "price": distress_price, "ts": now_ms()}
            print(f"  [{self.name}] DISTRESS: [{prop['name']}] @ {distress_price}g (60% price)")
            # Snap up distress deals if gold allows and we're not overloaded
            roi = prop["rent_per_tick"] / distress_price
            if (self.gold >= distress_price and self.alive and
                    len(self.owned_properties) < self.max_properties and roi > 0.012):
                self.owned_properties[pid] = prop
                self.gold -= distress_price
                self._recalc_passive_income()
                print(f"  [{self.name}] Seized distress [{prop['name']}] — +{prop['rent_per_tick']}g/tick")

    # ═══════════════════════════════════════════════════════════════════
    # UTILITY SCORING ENGINE
    # ═══════════════════════════════════════════════════════════════════

    def _w(self, action: str) -> float:
        """Return personality weight for an action (default 1.0)."""
        return self.weights.get(action, 1.0)

    def _on_cooldown(self, action: str) -> bool:
        """True if action fired too recently."""
        return now_ms() < self.cooldowns.get(action, 0)

    def _set_cooldown(self, action: str, seconds: float):
        self.cooldowns[action] = now_ms() + int(seconds * 1000)

    def _log_action(self, action: str, outcome: str):
        self.action_log.append((action, outcome, now_ms()))

    # ── Individual action scorers ──────────────────────────────────────

    def _score_heal_self(self) -> float:
        """Urgent when HP low and potions available."""
        if self.potions <= 0:
            return 0.0
        hp_pct = self.hp / self.max_hp
        if hp_pct >= self.heal_thr:
            return 0.0
        # Urgency ramps up steeply as HP falls below threshold
        urgency = clamp((self.heal_thr - hp_pct) / self.heal_thr)
        return urgency * self._w("heal_self")

    def _score_request_heal(self) -> float:
        """Broadcast heal request when low HP, no potions, peer available."""
        if self.potions > 0 or self._on_cooldown("request_heal"):
            return 0.0
        hp_pct = self.hp / self.max_hp
        if hp_pct >= self.heal_thr:
            return 0.0
        active_peers = [p for p in self.peers.values() if not p.get("stale")]
        if not active_peers:
            return 0.0
        urgency = clamp((self.heal_thr - hp_pct) / self.heal_thr)
        return urgency * 0.8 * self._w("request_heal")

    def _score_buy_potion(self) -> float:
        """Buy potions when stock low and gold comfortable."""
        if self.potions >= 3 or self.gold < 25:
            return 0.0
        # Higher score when totally out of potions
        stock_urgency = 1.0 - (self.potions / 3.0)
        # Only buy if gold surplus is healthy (don't bankrupt for a potion)
        gold_comfort = clamp((self.gold - 20) / 200.0)
        return stock_urgency * gold_comfort * 0.65 * self._w("buy_potion")

    def _score_retreat(self) -> float:
        """Force retreat when critically low HP, especially without cover."""
        hp_pct = self.hp / self.max_hp
        if hp_pct > self.retreat_thr:
            return 0.0
        urgency = clamp((self.retreat_thr - hp_pct) / max(self.retreat_thr, 0.01))
        # Less urgent if a peer is covering us
        if self.heal_cover_by:
            urgency *= 0.4
        return urgency * 1.2

    def _score_grind(self) -> float:
        """Score grinding in current zone (combat + gold income)."""
        if not self.zone:
            return 0.0
        hp_pct = self.hp / self.max_hp
        if hp_pct < self.retreat_thr:
            return 0.0
        # Actual performance vs expected (learned from history)
        actual_avg = self._zone_avg_gold(self.zone)
        expected   = ZONE_GOLD_PER_TICK[self.zone]
        perf_ratio = actual_avg / expected if actual_avg > 0 else 1.0
        # HP safety margin reduces grind score
        safety = clamp((hp_pct - self.retreat_thr) / (1.0 - self.retreat_thr))
        return clamp(perf_ratio * 0.75 * safety) * self._w("grind")

    def _score_claim_zone(self) -> float:
        """Score moving to a better zone."""
        if self._on_cooldown("claim_zone"):
            return 0.0
        hp_pct = self.hp / self.max_hp
        if hp_pct < self.heal_thr:
            return 0.0   # don't zone-hop while healing
        best = self._best_available_zone()
        if not best:
            return 0.0
        current_gold = ZONE_GOLD_PER_TICK.get(self.zone, 0) if self.zone else 0
        upgrade = (ZONE_GOLD_PER_TICK[best] - current_gold) / max(ZONE_GOLD_PER_TICK["Abyss"], 1)
        return clamp(upgrade * 0.9) * self._w("claim_zone")

    def _score_claim_quest(self) -> float:
        """Score picking up an unclaimed quest."""
        if self.quest or self._on_cooldown("claim_quest"):
            return 0.0
        available = [q for q in QUESTS if q not in self.quest_claims]
        if not available:
            return 0.0
        # Higher score when XP/level ratio suggests leveling is productive
        xp_need  = clamp(1.0 - self.xp / max(self.level * 100, 1))
        return xp_need * 0.70 * self._w("claim_quest")

    def _score_complete_quest(self) -> float:
        """Score completing the active quest (stochastic — 15% chance it's ready)."""
        if not self.quest:
            return 0.0
        # Real quest progress would come from the shard; simulate readiness here
        time_on_quest = sum(
            1 for a, _, _ in self.action_log if a == "grind"
        )
        ready_prob = clamp(time_on_quest * 0.05)   # more grinding → closer to done
        return ready_prob * 0.85 * self._w("claim_quest")

    def _score_invest_property(self) -> float:
        """Score buying a property based on ROI and gold surplus."""
        if len(self.owned_properties) >= self.max_properties:
            return 0.0
        if self.hp / self.max_hp < 0.65:
            return 0.0   # don't invest while hurt
        best = self._best_affordable_property()
        if not best:
            return 0.0
        roi         = best["rent_per_tick"] / best["price"]   # gold/tick per gold spent
        roi_score   = clamp(roi * 400)                         # normalise ~0.02 ROI → 0.8
        surplus_pct = (self.gold - best["price"]) / max(self.gold, 1)
        surplus_score = clamp(surplus_pct)
        return roi_score * surplus_score * 0.70 * self._w("invest_property")

    def _score_list_property(self) -> float:
        """Score listing a property for profit-taking."""
        if not self.owned_properties or self._on_cooldown("list_property"):
            return 0.0
        # List only if gold is tight or we're overloaded
        gold_need    = clamp(1.0 - self.gold / max(self.passive_income * 200, 500))
        overloaded   = 1.0 if len(self.owned_properties) >= self.max_properties else 0.2
        return gold_need * overloaded * 0.55 * self._w("list_property")

    # ── Top-level decision ─────────────────────────────────────────────

    def _score_and_act(self):
        """
        Compute utility scores for all actions, pick the highest,
        execute it, and log the outcome.
        """
        candidates = {
            "heal_self":       self._score_heal_self(),
            "request_heal":    self._score_request_heal(),
            "retreat":         self._score_retreat(),
            "buy_potion":      self._score_buy_potion(),
            "claim_zone":      self._score_claim_zone(),
            "grind":           self._score_grind(),
            "claim_quest":     self._score_claim_quest(),
            "complete_quest":  self._score_complete_quest(),
            "invest_property": self._score_invest_property(),
            "list_property":   self._score_list_property(),
        }

        # Pick highest-scoring action (ties broken randomly)
        best_action = max(candidates, key=lambda a: candidates[a] + random.uniform(0, 0.01))
        best_score  = candidates[best_action]

        if best_score < 0.05:
            self._act_wait()
            return

        executor = {
            "heal_self":       self._act_heal_self,
            "request_heal":    self._act_request_heal,
            "retreat":         self._act_retreat,
            "buy_potion":      self._act_buy_potion,
            "claim_zone":      self._act_claim_zone,
            "grind":           self._act_grind,
            "claim_quest":     self._act_claim_quest,
            "complete_quest":  self._act_complete_quest,
            "invest_property": self._act_invest_property,
            "list_property":   self._act_list_property,
        }
        executor[best_action]()

    # ═══════════════════════════════════════════════════════════════════
    # ACTION EXECUTORS
    # ═══════════════════════════════════════════════════════════════════

    def _act_heal_self(self):
        healed = int(self.max_hp * 0.40)
        self.hp = min(self.max_hp, self.hp + healed)
        self.potions -= 1
        self.heal_cover_by = None
        self._log_action("heal_self", "ok")
        print(f"  {self.emoji} [{self.name}] 🧪 Potion +{healed}HP | {self.potions} left | HP={self.hp}/{self.max_hp}")

    def _act_request_heal(self):
        publish_json(self.client, "wog/heal/request", {
            "agent": self.name, "hp": self.hp, "max_hp": self.max_hp, "timestamp": now_ms(),
        })
        self._set_cooldown("request_heal", 15)
        self._log_action("request_heal", "broadcast")
        print(f"  {self.emoji} [{self.name}] 🆘 HEAL REQUEST broadcast ({self.hp}/{self.max_hp} HP)")

    def _act_retreat(self):
        print(f"  {self.emoji} [{self.name}] 💨 RETREATING — HP critical ({self.hp}/{self.max_hp})")
        self._yield_zone()
        self._abandon_quest()
        self.state = FSMState.RETREATING
        self._log_action("retreat", "ok")
        self._set_cooldown("claim_zone", TICK_SEC * 4)

    def _act_buy_potion(self):
        self.gold -= 20
        self.potions += 1
        self._log_action("buy_potion", "ok")
        print(f"  {self.emoji} [{self.name}] 🛒 Bought potion (20g) — stock: {self.potions}")

    def _act_claim_zone(self):
        target = self._best_available_zone()
        if not target:
            return
        old_zone = self.zone
        if old_zone and old_zone != target:
            self._yield_zone()
        self._claim_zone(target)
        self._set_cooldown("claim_zone", TICK_SEC * 3)
        self._log_action("claim_zone", target)

    def _act_grind(self):
        if not self.zone:
            return
        danger    = ZONE_DANGER[self.zone]
        dmg_taken = max(0, random.randint(int(danger * 0.5), danger) - self.def_)
        self.hp   = max(0, self.hp - dmg_taken)

        gold_earned = ZONE_GOLD_PER_TICK[self.zone] + random.randint(-3, 5)
        xp_earned   = gold_earned // 2
        self.gold  += gold_earned
        self.xp    += xp_earned
        self.zone_perf[self.zone].append(gold_earned)
        if len(self.zone_perf[self.zone]) > 10:
            self.zone_perf[self.zone].pop(0)

        # Level up check
        xp_needed = self.level * 100
        if self.xp >= xp_needed:
            self.level += 1
            self.xp = 0
            print(f"  {self.emoji} [{self.name}] 🌟 LEVEL UP → {self.level}! (now eligible for more zones)")

        # Rare drop → P2P auction
        if random.random() < 0.04:
            item = random.choice(RARE_ITEMS)
            self._run_auction(item)

        self._log_action("grind", f"+{gold_earned}g")
        # Update FSM state based on new HP
        hp_pct = self.hp / self.max_hp
        if hp_pct < self.retreat_thr:
            self.state = FSMState.LOW_HP
        elif self.state in (FSMState.LOW_HP, FSMState.RETREATING):
            self.state = FSMState.ACTIVE

    def _act_claim_quest(self):
        available = [q for q in QUESTS if q not in self.quest_claims]
        if not available:
            return
        # Pick the quest least recently abandoned (recency bias avoidance)
        quest = random.choice(available)
        self._claim_quest(quest)
        self._set_cooldown("claim_quest", TICK_SEC * 2)
        self._log_action("claim_quest", quest)

    def _act_complete_quest(self):
        if not self.quest:
            return
        if random.random() > 0.15:   # 15% chance of completion per tick
            return
        reward = random.randint(30, 80)
        self.gold += reward
        self.xp   += 50
        print(f"  {self.emoji} [{self.name}] ✅ Quest COMPLETE: [{self.quest}] +{reward}g +50xp")
        completed = self.quest
        self._abandon_quest()   # publish abandon so peers see slot open
        self._log_action("complete_quest", f"{completed}+{reward}g")

    def _act_invest_property(self):
        best = self._best_affordable_property()
        if not best:
            return
        self.owned_properties[best["id"]] = best
        self.gold -= best["price"]
        self._recalc_passive_income()
        roi = best["rent_per_tick"] / best["price"]
        print(f"  {self.emoji} [{self.name}] 🏠 BOUGHT [{best['name']}] {best['price']}g | ROI={roi:.3f}/tick | +{best['rent_per_tick']}g/tick")
        publish_json(self.client, "wog/property/sold", {
            "agent": "realm", "buyer": self.name,
            "property_id": best["id"], "price": best["price"], "timestamp": now_ms(),
        })
        self._set_cooldown("invest_property", TICK_SEC * 5)
        self._log_action("invest_property", best["id"])

    def _act_list_property(self):
        # List the property with lowest ROI (worst performer goes first)
        candidates = [
            (pid, p["rent_per_tick"] / p["price"], p)
            for pid, p in self.owned_properties.items()
            if pid not in self.property_market
        ]
        if not candidates:
            return
        candidates.sort(key=lambda x: x[1])   # sort ascending ROI
        pid, roi, prop = candidates[0]
        ask = int(prop["price"] * 1.50)   # 50% markup
        self.property_market[pid] = {"seller": self.name, "price": ask, "ts": now_ms()}
        publish_json(self.client, "wog/property/list", {
            "agent": self.name, "property_id": pid, "name": prop["name"],
            "zone": prop["zone"], "tier": prop["tier"],
            "price": ask, "rent_per_tick": prop["rent_per_tick"], "timestamp": now_ms(),
        })
        print(f"  {self.emoji} [{self.name}] 📋 Listed [{prop['name']}] @ {ask}g (ROI={roi:.3f} — worst performer)")
        self._set_cooldown("list_property", 30)
        self._log_action("list_property", f"{pid}@{ask}g")

    def _act_wait(self):
        regen = max(1, int(self.max_hp * 0.015))   # 1.5% HP regen on wait
        self.hp = min(self.max_hp, self.hp + regen)
        if self.state == FSMState.RETREATING and self.hp / self.max_hp > self.heal_thr:
            self.state = FSMState.ACTIVE
            print(f"  {self.emoji} [{self.name}] 💚 Recovered — returning ACTIVE")
        self._log_action("wait", "regen")

    # ═══════════════════════════════════════════════════════════════════
    # FSM TICK
    # ═══════════════════════════════════════════════════════════════════

    def _tick(self):
        """Main decision tick — runs FSM then utility scoring."""
        # Passive income every tick regardless of state
        if self.passive_income > 0:
            self.gold += self.passive_income
            if random.random() < 0.25:
                print(f"  [{self.name}] 💰 Passive +{self.passive_income}g ({len(self.owned_properties)} props)")

        # FSM dispatch
        if self.state == FSMState.DEAD:
            if now_ms() >= self.respawn_at:
                self._do_respawn()
            return

        if self.state == FSMState.RESPAWNING:
            self.state = FSMState.ACTIVE
            return

        # HP death check before decisions
        if self.hp <= 0:
            self._die()
            return

        # Run utility scoring (works across ACTIVE / LOW_HP / RETREATING)
        self._score_and_act()

    # ═══════════════════════════════════════════════════════════════════
    # COORDINATION ACTIONS  (publish to FoxMQ)
    # ═══════════════════════════════════════════════════════════════════

    def _claim_zone(self, zone: str):
        self.zone = zone
        self.zone_claims[zone] = self.name
        publish_json(self.client, "wog/zone/claim", {
            "agent": self.name, "zone": zone, "timestamp": now_ms(),
        })
        print(f"  {self.emoji} [{self.name}] 🗺️  Claiming zone: {zone}")

    def _yield_zone(self):
        if self.zone:
            publish_json(self.client, "wog/zone/yield", {
                "agent": self.name, "zone": self.zone, "timestamp": now_ms(),
            })
            self.zone_claims.pop(self.zone, None)
            self.zone = None

    def _claim_quest(self, quest: str):
        self.quest = quest
        self.quest_claims[quest] = self.name
        publish_json(self.client, "wog/quest/claim", {
            "agent": self.name, "quest": quest, "timestamp": now_ms(),
        })
        print(f"  {self.emoji} [{self.name}] 📜 Claimed quest: [{quest}]")

    def _abandon_quest(self):
        if self.quest:
            publish_json(self.client, "wog/quest/abandon", {
                "agent": self.name, "quest": self.quest, "timestamp": now_ms(),
            })
            self.quest_claims.pop(self.quest, None)
            self.quest = None

    # ═══════════════════════════════════════════════════════════════════
    # LIFECYCLE
    # ═══════════════════════════════════════════════════════════════════

    @property
    def alive(self) -> bool:
        return self.state not in (FSMState.DEAD, FSMState.RESPAWNING)

    def _die(self):
        print(f"\n  {self.emoji} [{self.name}] ☠️  DIED — releasing zone/quest, distress-auctioning properties")
        self.state = FSMState.DEAD
        self.hp    = 0
        self._yield_zone()
        self._abandon_quest()
        if self.owned_properties:
            publish_json(self.client, "wog/property/distress", {
                "agent": self.name, "properties": list(self.owned_properties.keys()),
                "timestamp": now_ms(),
            })
            print(f"  [{self.name}] DISTRESS: {len(self.owned_properties)} properties @ 60% price")
        self.respawn_at = now_ms() + 10_000
        self.heal_cover_by = None

    def _do_respawn(self):
        self.hp    = self.max_hp // 2
        self.gold  = max(self.gold, 30)
        self.state = FSMState.RESPAWNING
        print(f"\n  {self.emoji} [{self.name}] ✨ RESPAWNED — back at {self.hp}/{self.max_hp} HP")

    # ═══════════════════════════════════════════════════════════════════
    # SELECTION HELPERS
    # ═══════════════════════════════════════════════════════════════════

    def _best_available_zone(self) -> str | None:
        """
        Pick the highest gold-per-tick zone that:
         - meets level requirement
         - is not claimed by another agent
         - danger is survivable given current def_
         - is different from current zone (upgrade)
        """
        eligible = [
            z for z in ZONES
            if ZONE_MIN_LEVEL[z] <= self.level
            and z not in self.zone_claims
            and ZONE_DANGER[z] - self.def_ < self.hp   # at least 1 tick survivable
        ]
        if not eligible:
            return None
        # Sort by gold rate; bias toward safer zones when HP is low
        hp_pct = self.hp / self.max_hp
        def zone_score(z):
            gold   = ZONE_GOLD_PER_TICK[z]
            danger = ZONE_DANGER[z]
            safety = clamp(1.0 - danger / 100.0)
            return gold * (0.5 + hp_pct * 0.5) + safety * (1.0 - hp_pct) * 20
        eligible.sort(key=zone_score, reverse=True)
        best = eligible[0]
        return best if best != self.zone else (eligible[1] if len(eligible) > 1 else None)

    def _best_affordable_property(self) -> dict | None:
        """
        Find the best ROI property we can afford, not already owned, not flooded
        with peer owners.
        """
        owned_ids = set(self.owned_properties.keys())
        candidates = [
            p for p in PROPERTY_CATALOG
            if p["id"] not in owned_ids and self.gold >= p["price"]
        ]
        if not candidates:
            return None
        # Sort by ROI descending
        candidates.sort(key=lambda p: p["rent_per_tick"] / p["price"], reverse=True)
        return candidates[0]

    def _zone_avg_gold(self, zone: str) -> float:
        """Average gold earned in this zone from recent history."""
        hist = self.zone_perf.get(zone, [])
        return sum(hist) / len(hist) if hist else ZONE_GOLD_PER_TICK.get(zone, 0)

    def _recalc_passive_income(self):
        self.passive_income = sum(p["rent_per_tick"] for p in self.owned_properties.values())

    # ═══════════════════════════════════════════════════════════════════
    # LOOT AUCTION
    # ═══════════════════════════════════════════════════════════════════

    def _run_auction(self, item: str):
        print(f"  {self.emoji} [{self.name}] 🏆 RARE DROP: [{item}] — starting P2P auction!")
        self.pending_bids[item] = {}
        publish_json(self.client, "wog/loot/auction", {
            "agent": self.name, "item": item, "timestamp": now_ms(),
        })
        threading.Timer(4.0, self._resolve_auction, args=[item]).start()

    def _resolve_auction(self, item: str):
        with self.lock:
            bids = self.pending_bids.pop(item, {})
            if not bids:
                print(f"  {self.emoji} [{self.name}] 🏆 No bids for [{item}] — keeping it")
                return
            winner = max(bids, key=bids.get)
            price  = bids[winner]
            print(f"  {self.emoji} [{self.name}] 🏆 Auction: {winner} wins [{item}] for {price}g (P2P, no fees)")
            if winner != self.name:
                self.gold += price

    # ═══════════════════════════════════════════════════════════════════
    # HEARTBEAT + STATUS
    # ═══════════════════════════════════════════════════════════════════

    def _broadcast_state(self):
        publish_json(self.client, "wog/heartbeat", {
            "agent": self.name, "cls": self.cls,
            "hp": self.hp, "max_hp": self.max_hp,
            "gold": self.gold, "level": self.level,
            "zone": self.zone, "quest": self.quest,
            "alive": self.alive, "state": self.state.name,
            "timestamp": now_ms(),
            "properties": list(self.owned_properties.keys()),
            "passive_income": self.passive_income,
        })

    def _print_status(self):
        zone_str  = self.zone or "—"
        quest_str = (self.quest[:25] + "…") if self.quest and len(self.quest) > 25 else (self.quest or "—")
        state_str = self.state.name
        # Last 3 actions from memory
        recent = " → ".join(f"{a}({o})" for a, o, _ in list(self.action_log)[-3:]) or "—"
        print(
            f"  {self.emoji} [{self.name:<6}] "
            f"HP:{fmt_hp(self.hp, self.max_hp)} "
            f"Lv:{self.level} Gold:{self.gold:>5}g "
            f"Zone:{zone_str:<8} Quest:{quest_str:<20} "
            f"[{state_str}] last: {recent}"
        )

    # ═══════════════════════════════════════════════════════════════════
    # BACKGROUND LOOPS
    # ═══════════════════════════════════════════════════════════════════

    def _stale_check_loop(self):
        while True:
            time.sleep(5)
            with self.lock:
                cutoff = now_ms() - STALE_SEC * 1000
                for peer, info in self.peers.items():
                    if not info.get("stale") and info.get("last_seen", 0) < cutoff:
                        info["stale"] = True
                        print(f"\n  {self.emoji} [{self.name}] ⚠️  DETECTED FAILURE: {peer} offline")
                        for zone, owner in list(self.zone_claims.items()):
                            if owner == peer:
                                del self.zone_claims[zone]
                                print(f"  {self.emoji} [{self.name}] 🗺️  [{zone}] now unclaimed")

    def _heartbeat_loop(self):
        while True:
            time.sleep(HEARTBEAT_SEC)
            with self.lock:
                self._broadcast_state()

    def _decision_loop(self):
        time.sleep(random.uniform(0.5, 2.0))   # stagger starts
        while True:
            with self.lock:
                self._tick()
            self._print_status()
            time.sleep(TICK_SEC)

    def start_threads(self):
        for target in [self._heartbeat_loop, self._decision_loop, self._stale_check_loop]:
            t = threading.Thread(target=target, daemon=True)
            t.start()

    def connect(self):
        self.client.connect(BROKER_HOST, BROKER_PORT)
        self.client.loop_start()


# ════════════════════════════════════════════════════════════════════════════
def run_single(name: str):
    agent = WoGAgent(name)
    agent.connect()
    agent.start_threads()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print(f"\n{PERSONALITIES[name]['emoji']} [{name}] Disconnecting...")

def run_all():
    print("=" * 72)
    print("  World of Guilds — Leaderless P2P Agent Economy")
    print("  Vertex Swarm Challenge 2026 | Track 3: The Agent Economy")
    print("  3 autonomous agents. No orchestrator. FoxMQ consensus mesh.")
    print("  Decision engine: Utility AI + FSM + short-term memory")
    print("=" * 72 + "\n")

    agents = [WoGAgent(name) for name in PERSONALITIES]
    for agent in agents:
        agent.connect()
        time.sleep(0.5)
    for agent in agents:
        agent.start_threads()

    print("\n[SWARM LIVE] Agents discovering each other via FoxMQ...\n")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n\n[SWARM STOPPED]")
        for agent in agents:
            totals = f"Lv:{agent.level} Gold:{agent.gold}g Props:{len(agent.owned_properties)}"
            print(f"  {PERSONALITIES[agent.name]['emoji']} {agent.name}: {totals}")
            if agent.action_log:
                print(f"    Last actions: {' → '.join(a for a, _, _ in list(agent.action_log)[-5:])}")


# ════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] in PERSONALITIES:
        run_single(sys.argv[1])
    else:
        run_all()
