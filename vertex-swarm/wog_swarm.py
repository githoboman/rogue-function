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

Topics:
  wog/heartbeat          - agent state broadcast (HP, gold, zone, level)
  wog/zone/claim         - claim exclusive rights to a grinding zone
  wog/zone/yield         - release a zone (on death or retreat)
  wog/quest/claim        - claim a quest task
  wog/quest/abandon      - abandon quest (hand off to peers)
  wog/heal/request       - broadcast low-HP alert, request peer support
  wog/heal/response      - healthy agent offers to tank while requester heals
  wog/loot/auction       - announce rare item drop, open bidding
  wog/loot/bid           - agent bids on item with gold offer

Run:
  python wog_swarm.py              # all 3 agents in one terminal (threaded)
  python wog_swarm.py ragnar       # single agent (run 3 separate terminals)
"""

import sys
import json
import time
import random
import threading
import paho.mqtt.client as mqtt
from paho.mqtt.enums import MQTTProtocolVersion

# Windows terminal UTF-8 fix (Python 3.7+)
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

BROKER_HOST = "localhost"
BROKER_PORT  = 1883
TICK_SEC     = 3      # decision tick
HEARTBEAT_SEC = 2     # state broadcast interval
STALE_SEC    = 10     # peer considered dead after this

# ── World constants ──────────────────────────────────────────────────
ZONES = ["Forest", "Dungeon", "Volcano", "Glacier", "Abyss"]
QUESTS = [
    "Slay 10 Goblins", "Deliver Herbs", "Escort Merchant",
    "Collect Dragon Scales", "Scout the Ruins", "Defend the Gate",
]
RARE_ITEMS = ["Flame Sword", "Shadow Cloak", "Arcane Staff", "Iron Shield"]

ZONE_GOLD_PER_TICK = {"Forest": 8, "Dungeon": 15, "Volcano": 22, "Glacier": 30, "Abyss": 45}
ZONE_MIN_LEVEL     = {"Forest": 1, "Dungeon": 3,  "Volcano": 5,  "Glacier": 7,  "Abyss": 10}

# ── Agent personalities ──────────────────────────────────────────────
PERSONALITIES = {
    "ragnar": {
        "class": "Warrior", "emoji": "⚔️",
        "max_hp": 200, "atk": 25, "def_": 15,
        "style": "aggressive",   # pushes hardest zones, hoards gold
        "heal_threshold": 0.30,  # heals only when very low
        "retreat_threshold": 0.15,
    },
    "lyria": {
        "class": "Mage", "emoji": "🔮",
        "max_hp": 120, "atk": 40, "def_": 5,
        "style": "cautious",     # stays safer zones, stockpiles potions
        "heal_threshold": 0.55,
        "retreat_threshold": 0.35,
    },
    "kira": {
        "class": "Ranger", "emoji": "🏹",
        "max_hp": 150, "atk": 30, "def_": 10,
        "style": "quest",        # prioritises quests for XP
        "heal_threshold": 0.40,
        "retreat_threshold": 0.25,
    },
}

def now_ms():
    return int(time.time() * 1000)

def publish_json(client, topic, payload, qos=1):
    client.publish(topic, json.dumps(payload), qos=qos)

def fmt_hp(hp, max_hp):
    pct = hp / max_hp
    bar = "█" * int(pct * 10) + "░" * (10 - int(pct * 10))
    return f"[{bar}] {hp}/{max_hp} ({pct*100:.0f}%)"

# ════════════════════════════════════════════════════════════════════
class WoGAgent:
    def __init__(self, name: str):
        p = PERSONALITIES[name]
        self.name       = name
        self.cls        = p["class"]
        self.emoji      = p["emoji"]
        self.style      = p["style"]
        self.max_hp     = p["max_hp"]
        self.hp         = p["max_hp"]
        self.atk        = p["atk"]
        self.def_       = p["def_"]
        self.heal_thr   = p["heal_threshold"]
        self.retreat_thr= p["retreat_threshold"]

        self.gold       = 50
        self.level      = 1
        self.xp         = 0
        self.zone       = None        # currently claimed zone
        self.quest      = None        # currently claimed quest
        self.potions    = 2
        self.alive      = True
        self.respawn_at = 0           # timestamp for respawn

        # P2P state
        self.peers      = {}          # name → last heartbeat data
        self.zone_claims= {}          # zone → agent_name (consensus state)
        self.quest_claims= {}         # quest → agent_name
        self.pending_bids= {}         # item → {bidder: gold}

        self.lock = threading.Lock()

        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=name,
            protocol=MQTTProtocolVersion.MQTTv5,
        )
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message

    # ── MQTT ─────────────────────────────────────────────────────────
    def _on_connect(self, client, userdata, flags, rc, props):
        print(f"\n{self.emoji} [{self.name.upper()}] Connected to FoxMQ consensus mesh")
        client.subscribe("wog/#", qos=1)
        self._broadcast_state()

    def _on_message(self, client, userdata, msg):
        try:
            data = json.loads(msg.payload)
        except:
            return
        sender = data.get("agent")
        if sender == self.name:
            return

        topic = msg.topic
        with self.lock:
            if topic == "wog/heartbeat":
                self._handle_heartbeat(sender, data)
            elif topic == "wog/zone/claim":
                self._handle_zone_claim(sender, data)
            elif topic == "wog/zone/yield":
                self._handle_zone_yield(sender, data)
            elif topic == "wog/quest/claim":
                self._handle_quest_claim(sender, data)
            elif topic == "wog/quest/abandon":
                self._handle_quest_abandon(sender, data)
            elif topic == "wog/heal/request":
                self._handle_heal_request(sender, data)
            elif topic == "wog/heal/response":
                self._handle_heal_response(sender, data)
            elif topic == "wog/loot/auction":
                self._handle_auction(sender, data)
            elif topic == "wog/loot/bid":
                self._handle_bid(sender, data)

    # ── Message handlers (all run under self.lock) ───────────────────
    def _handle_heartbeat(self, sender, data):
        was_stale = sender in self.peers and self.peers[sender].get("stale")
        self.peers[sender] = {**data, "stale": False, "last_seen": now_ms()}
        if was_stale:
            print(f"  {self.emoji} [{self.name}] 🔄 Peer RECOVERED: {sender}")
            # redistribute their abandoned zones/quests
            for zone, owner in list(self.zone_claims.items()):
                if owner == sender:
                    del self.zone_claims[zone]

    def _handle_zone_claim(self, sender, data):
        zone = data["zone"]
        # FoxMQ consensus ordering: first message wins — no arbitrator needed
        if zone not in self.zone_claims:
            self.zone_claims[zone] = sender
            print(f"  {self.emoji} [{self.name}] 📍 Consensus: {sender} owns {zone}")
        else:
            current = self.zone_claims[zone]
            if current != sender:
                print(f"  {self.emoji} [{self.name}] ⚡ Zone conflict {zone}: {current} holds vs {sender} — {current} wins (BFT order)")

    def _handle_zone_yield(self, sender, data):
        zone = data["zone"]
        if self.zone_claims.get(zone) == sender:
            del self.zone_claims[zone]
            print(f"  {self.emoji} [{self.name}] 🏳️  {sender} yielded {zone} — zone open")

    def _handle_quest_claim(self, sender, data):
        quest = data["quest"]
        if quest not in self.quest_claims:
            self.quest_claims[quest] = sender
            print(f"  {self.emoji} [{self.name}] 📜 Consensus: {sender} took quest [{quest}]")

    def _handle_quest_abandon(self, sender, data):
        quest = data["quest"]
        if self.quest_claims.get(quest) == sender:
            del self.quest_claims[quest]
            print(f"  {self.emoji} [{self.name}] ❌ {sender} abandoned [{quest}] — open for pickup")
            # Opportunistically claim if style matches
            if self.style == "quest" and self.quest is None and self.alive:
                self._claim_quest(quest)

    def _handle_heal_request(self, sender, data):
        # Healthy agents offer to cover while requester heals
        if self.hp / self.max_hp > 0.7 and self.alive:
            print(f"  {self.emoji} [{self.name}] 💊 Offering heal cover to {sender}")
            publish_json(self.client, "wog/heal/response", {
                "agent": self.name, "target": sender,
                "timestamp": now_ms(), "coverage": "tanking",
            })

    def _handle_heal_response(self, sender, data):
        if data.get("target") == self.name:
            print(f"  {self.emoji} [{self.name}] 🛡️  {sender} covering — using potion safely")

    def _handle_auction(self, sender, data):
        item = data["item"]
        # Bid if we have gold and the item suits our class
        desire = {"Warrior": "Iron Shield", "Mage": "Arcane Staff", "Ranger": "Shadow Cloak"}.get(self.cls)
        max_bid = min(self.gold // 3, 40) if self.gold > 20 else 0
        bid = random.randint(max_bid // 2, max_bid) if max_bid > 0 else 0
        if item == desire:
            bid = min(self.gold // 2, 60)  # bid harder for preferred item
        if bid > 0:
            print(f"  {self.emoji} [{self.name}] 💰 Bidding {bid}g on [{item}]")
            publish_json(self.client, "wog/loot/bid", {
                "agent": self.name, "item": item, "gold": bid, "timestamp": now_ms(),
            })

    def _handle_bid(self, sender, data):
        item = data["item"]
        gold = data["gold"]
        if item not in self.pending_bids:
            self.pending_bids[item] = {}
        self.pending_bids[item][sender] = gold

    # ── P2P coordination actions ─────────────────────────────────────
    def _claim_zone(self, zone):
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
            self.zone = None

    def _claim_quest(self, quest=None):
        if quest is None:
            available = [q for q in QUESTS if q not in self.quest_claims]
            if not available:
                return
            quest = random.choice(available)
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
            if self.quest in self.quest_claims:
                del self.quest_claims[self.quest]
            self.quest = None

    def _request_heal(self):
        publish_json(self.client, "wog/heal/request", {
            "agent": self.name, "hp": self.hp, "max_hp": self.max_hp,
            "timestamp": now_ms(),
        })
        print(f"  {self.emoji} [{self.name}] 🆘 Broadcasting HEAL REQUEST ({self.hp}/{self.max_hp} HP)")

    def _run_auction(self, item):
        print(f"  {self.emoji} [{self.name}] 🏆 RARE DROP: [{item}] — starting P2P auction!")
        self.pending_bids[item] = {}
        publish_json(self.client, "wog/loot/auction", {
            "agent": self.name, "item": item, "timestamp": now_ms(),
        })
        # resolve after 4s (let bids come in)
        threading.Timer(4.0, self._resolve_auction, args=[item]).start()

    def _resolve_auction(self, item):
        with self.lock:
            bids = self.pending_bids.pop(item, {})
            if not bids:
                print(f"  {self.emoji} [{self.name}] 🏆 No bids for [{item}] — keeping it")
                return
            winner = max(bids, key=bids.get)
            price = bids[winner]
            print(f"  {self.emoji} [{self.name}] 🏆 Auction resolved: {winner} wins [{item}] for {price}g (P2P settlement, no fees)")
            if winner != self.name:
                self.gold += price  # receive payment

    def _broadcast_state(self):
        publish_json(self.client, "wog/heartbeat", {
            "agent": self.name, "cls": self.cls,
            "hp": self.hp, "max_hp": self.max_hp,
            "gold": self.gold, "level": self.level,
            "zone": self.zone, "quest": self.quest,
            "alive": self.alive, "timestamp": now_ms(),
        })

    # ── Decision engine (no orchestrator) ────────────────────────────
    def _decide(self):
        if not self.alive:
            if now_ms() >= self.respawn_at:
                self._respawn()
            return

        # 1. Passive HP regen (1% per tick)
        regen = max(1, int(self.max_hp * 0.01))
        self.hp = min(self.max_hp, self.hp + regen)

        # 2. Death check
        if self.hp <= 0:
            self._die()
            return

        # 3. Heal if low HP
        hp_pct = self.hp / self.max_hp
        if hp_pct < self.heal_thr:
            if self.potions > 0:
                healed = int(self.max_hp * 0.40)
                self.hp = min(self.max_hp, self.hp + healed)
                self.potions -= 1
                print(f"  {self.emoji} [{self.name}] 🧪 Used potion +{healed}HP | {self.potions} left")
            else:
                self._request_heal()
                if hp_pct < self.retreat_thr:
                    print(f"  {self.emoji} [{self.name}] 💨 RETREATING — no potions & critically low")
                    self._yield_zone()
                    self._abandon_quest()
                    return

        # 4. Buy potion if gold allows and low on stock
        if self.potions < 2 and self.gold >= 20:
            self.gold -= 20
            self.potions += 1
            print(f"  {self.emoji} [{self.name}] 🛒 Bought potion (20g)")

        # 5. Pick a zone based on personality
        if self.zone is None:
            target = self._pick_zone()
            if target:
                self._claim_zone(target)

        # 6. Pick a quest
        if self.quest is None and self.style in ("quest", "cautious"):
            self._claim_quest()
        elif self.quest is None and self.style == "aggressive" and random.random() < 0.3:
            self._claim_quest()

        # 7. Combat simulation in current zone
        if self.zone:
            dmg_taken = max(0, random.randint(5, 30) - self.def_)
            self.hp = max(0, self.hp - dmg_taken)
            gold_earned = ZONE_GOLD_PER_TICK.get(self.zone, 8)
            xp_earned = gold_earned // 2
            self.gold += gold_earned
            self.xp += xp_earned

            # Level up
            xp_needed = self.level * 100
            if self.xp >= xp_needed:
                self.level += 1
                self.xp = 0
                print(f"  {self.emoji} [{self.name}] 🌟 LEVEL UP → {self.level}!")

            # Rare drop → P2P auction
            if random.random() < 0.04:
                item = random.choice(RARE_ITEMS)
                self._run_auction(item)

        # 8. Quest completion
        if self.quest and random.random() < 0.15:
            reward = random.randint(30, 80)
            self.gold += reward
            self.xp += 50
            print(f"  {self.emoji} [{self.name}] ✅ Quest COMPLETE: [{self.quest}] +{reward}g +50xp")
            if self.quest in self.quest_claims:
                del self.quest_claims[self.quest]
            self.quest = None

    def _pick_zone(self):
        if self.style == "aggressive":
            # Push hardest affordable zone
            eligible = [z for z in ZONES if ZONE_MIN_LEVEL[z] <= self.level]
            candidates = [z for z in eligible if z not in self.zone_claims]
            return candidates[-1] if candidates else (eligible[-1] if eligible else None)
        elif self.style == "cautious":
            eligible = [z for z in ZONES if ZONE_MIN_LEVEL[z] <= max(1, self.level - 1)]
            candidates = [z for z in eligible if z not in self.zone_claims]
            return candidates[0] if candidates else None
        else:  # quest — mid-range zone
            eligible = [z for z in ZONES if ZONE_MIN_LEVEL[z] <= self.level]
            candidates = [z for z in eligible if z not in self.zone_claims]
            mid = len(candidates) // 2
            return candidates[mid] if candidates else None

    def _die(self):
        print(f"\n  {self.emoji} [{self.name}] 💀 DIED — yielding zone and quests. Respawning in 10s...")
        self.alive = False
        self.hp = 0
        self._yield_zone()
        self._abandon_quest()
        self.respawn_at = now_ms() + 10_000

    def _respawn(self):
        self.alive = True
        self.hp = self.max_hp // 2
        self.gold = max(self.gold, 30)
        print(f"\n  {self.emoji} [{self.name}] ✨ RESPAWNED — rejoining swarm")

    # ── Main loops ───────────────────────────────────────────────────
    def _stale_check_loop(self):
        while True:
            time.sleep(5)
            with self.lock:
                cutoff = now_ms() - STALE_SEC * 1000
                for peer, info in self.peers.items():
                    if not info.get("stale") and info.get("last_seen", 0) < cutoff:
                        info["stale"] = True
                        print(f"\n  {self.emoji} [{self.name}] ⚠️  DETECTED FAILURE: {peer} offline — redistributing their tasks")
                        # release their zone claims so others can take them
                        for zone, owner in list(self.zone_claims.items()):
                            if owner == peer:
                                del self.zone_claims[zone]
                                print(f"  {self.emoji} [{self.name}] 🗺️  Zone {zone} is now unclaimed")

    def _heartbeat_loop(self):
        while True:
            time.sleep(HEARTBEAT_SEC)
            self._broadcast_state()

    def _decision_loop(self):
        time.sleep(random.uniform(1, 3))  # stagger starts
        while True:
            with self.lock:
                self._decide()
            self._print_status()
            time.sleep(TICK_SEC)

    def _print_status(self):
        zone_str  = self.zone or "—"
        quest_str = (self.quest[:25] + "…") if self.quest and len(self.quest) > 25 else (self.quest or "—")
        status    = "DEAD" if not self.alive else "alive"
        print(
            f"  {self.emoji} [{self.name:<6}] "
            f"HP:{fmt_hp(self.hp, self.max_hp)} "
            f"Lv:{self.level} Gold:{self.gold:>4}g "
            f"Zone:{zone_str:<8} Quest:{quest_str} [{status}]"
        )

    def start_threads(self):
        for target in [self._heartbeat_loop, self._decision_loop, self._stale_check_loop]:
            t = threading.Thread(target=target, daemon=True)
            t.start()

    def connect(self):
        self.client.connect(BROKER_HOST, BROKER_PORT)
        self.client.loop_start()

# ════════════════════════════════════════════════════════════════════
def run_single(name):
    agent = WoGAgent(name)
    agent.connect()
    agent.start_threads()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print(f"\n{PERSONALITIES[name]['emoji']} [{name}] Disconnecting...")

def run_all():
    print("=" * 70)
    print("  World of Guilds — Leaderless P2P Agent Economy")
    print("  Vertex Swarm Challenge 2026 | Track 3: The Agent Economy")
    print("  3 autonomous agents. No orchestrator. FoxMQ consensus mesh.")
    print("=" * 70 + "\n")

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
            totals = f"Lv:{agent.level} Gold:{agent.gold}g"
            print(f"  {agent.emoji} {agent.name}: {totals}")

# ════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] in PERSONALITIES:
        run_single(sys.argv[1])
    else:
        run_all()
