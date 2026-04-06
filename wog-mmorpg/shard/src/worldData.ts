/**
 * worldData.ts — Static World Definitions
 * Zones, mob templates, NPC definitions, item catalog
 */

// ============================================================
// TYPES
// ============================================================

export interface MobTemplate {
  id: string;
  name: string;
  level: number;
  hp: number;
  attack: number;
  defense: number;
  xpReward: number;
  goldDrop: [number, number]; // [min, max]
  lootTable: { itemTemplateId: number; chance: number }[];
  respawnSeconds: number;
  aggressive: boolean; // attacks players on sight
}

export interface NPCDefinition {
  id: string;
  name: string;
  role: "quest_giver" | "merchant" | "trainer";
  zone: string;
  position: { x: number; y: number };
  quests: string[];         // quest IDs this NPC gives
  shopInventory?: number[]; // item template IDs sold
  dialogue: string;
}

export interface ZoneDefinition {
  id: string;
  name: string;
  levelRange: [number, number];
  description: string;
  spawnPoints: { x: number; y: number }[];
  mobSpawns: { templateId: string; position: { x: number; y: number }; count: number }[];
  npcs: string[];           // NPC IDs in this zone
  portals: { targetZone: string; position: { x: number; y: number }; requiredLevel: number }[];
  ambientMobs: string[];    // mob template IDs that roam freely
}

export interface ItemTemplate {
  id: number;
  name: string;
  type: "weapon" | "armor" | "helmet" | "boots" | "potion" | "material" | "quest";
  rarity: 0 | 1 | 2 | 3;   // common/uncommon/rare/epic
  levelReq: number;
  attackBonus: number;
  defenseBonus: number;
  hpRestore: number;
  goldValue: number;
}

// ============================================================
// ITEM CATALOG
// ============================================================

export const ITEM_TEMPLATES: Record<number, ItemTemplate> = {
  // Weapons
  1:  { id: 1,  name: "Rusty Sword",      type: "weapon", rarity: 0, levelReq: 1,  attackBonus: 5,  defenseBonus: 0, hpRestore: 0,  goldValue: 50  },
  2:  { id: 2,  name: "Iron Sword",        type: "weapon", rarity: 1, levelReq: 3,  attackBonus: 12, defenseBonus: 0, hpRestore: 0,  goldValue: 150 },
  3:  { id: 3,  name: "Steel Sword",       type: "weapon", rarity: 1, levelReq: 6,  attackBonus: 22, defenseBonus: 0, hpRestore: 0,  goldValue: 350 },
  4:  { id: 4,  name: "Shadow Blade",      type: "weapon", rarity: 2, levelReq: 10, attackBonus: 38, defenseBonus: 0, hpRestore: 0,  goldValue: 800 },
  5:  { id: 5,  name: "Gnarled Staff",     type: "weapon", rarity: 0, levelReq: 1,  attackBonus: 4,  defenseBonus: 2, hpRestore: 0,  goldValue: 45  },
  6:  { id: 6,  name: "Oak Bow",           type: "weapon", rarity: 0, levelReq: 1,  attackBonus: 6,  defenseBonus: 0, hpRestore: 0,  goldValue: 55  },
  // Armor
  10: { id: 10, name: "Cloth Shirt",       type: "armor",  rarity: 0, levelReq: 1,  attackBonus: 0,  defenseBonus: 3, hpRestore: 0,  goldValue: 30  },
  11: { id: 11, name: "Leather Vest",      type: "armor",  rarity: 0, levelReq: 2,  attackBonus: 0,  defenseBonus: 7, hpRestore: 0,  goldValue: 80  },
  12: { id: 12, name: "Chainmail",         type: "armor",  rarity: 1, levelReq: 5,  attackBonus: 0,  defenseBonus: 15,hpRestore: 0,  goldValue: 250 },
  13: { id: 13, name: "Plate Armor",       type: "armor",  rarity: 2, levelReq: 9,  attackBonus: 0,  defenseBonus: 28,hpRestore: 0,  goldValue: 700 },
  // Potions
  20: { id: 20, name: "Minor Health Potion",type:"potion", rarity: 0, levelReq: 1,  attackBonus: 0,  defenseBonus: 0, hpRestore: 50, goldValue: 25  },
  21: { id: 21, name: "Health Potion",     type: "potion", rarity: 0, levelReq: 1,  attackBonus: 0,  defenseBonus: 0, hpRestore: 150,goldValue: 60  },
  22: { id: 22, name: "Greater Health Potion",type:"potion",rarity:1, levelReq: 5,  attackBonus: 0,  defenseBonus: 0, hpRestore: 400,goldValue: 150 },
  // Materials (for crafting/quests)
  30: { id: 30, name: "Rat Pelt",          type: "material",rarity:0, levelReq: 1,  attackBonus: 0,  defenseBonus: 0, hpRestore: 0,  goldValue: 5   },
  31: { id: 31, name: "Wolf Fang",         type: "material",rarity:0, levelReq: 1,  attackBonus: 0,  defenseBonus: 0, hpRestore: 0,  goldValue: 8   },
  32: { id: 32, name: "Boar Tusk",         type: "material",rarity:0, levelReq: 2,  attackBonus: 0,  defenseBonus: 0, hpRestore: 0,  goldValue: 10  },
  33: { id: 33, name: "Goblin Ear",        type: "material",rarity:0, levelReq: 3,  attackBonus: 0,  defenseBonus: 0, hpRestore: 0,  goldValue: 12  },
  34: { id: 34, name: "Spider Silk",       type: "material",rarity:1, levelReq: 6,  attackBonus: 0,  defenseBonus: 0, hpRestore: 0,  goldValue: 25  },
  35: { id: 35, name: "Shadow Essence",    type: "material",rarity:2, levelReq: 12, attackBonus: 0,  defenseBonus: 0, hpRestore: 0,  goldValue: 100 },
};

// ============================================================
// MOB TEMPLATES
// ============================================================

export const MOB_TEMPLATES: Record<string, MobTemplate> = {
  // ── Human Meadow (Levels 1-5) ──────────────────────────
  giant_rat: {
    id: "giant_rat", name: "Giant Rat", level: 1, hp: 30, attack: 4, defense: 1,
    xpReward: 15, goldDrop: [1, 5], respawnSeconds: 30, aggressive: false,
    lootTable: [{ itemTemplateId: 30, chance: 0.6 }],
  },
  young_wolf: {
    id: "young_wolf", name: "Young Wolf", level: 2, hp: 55, attack: 8, defense: 2,
    xpReward: 28, goldDrop: [2, 8], respawnSeconds: 45, aggressive: true,
    lootTable: [{ itemTemplateId: 31, chance: 0.5 }],
  },
  wild_boar: {
    id: "wild_boar", name: "Wild Boar", level: 3, hp: 80, attack: 12, defense: 4,
    xpReward: 45, goldDrop: [4, 12], respawnSeconds: 60, aggressive: false,
    lootTable: [{ itemTemplateId: 32, chance: 0.55 }],
  },
  goblin_scout: {
    id: "goblin_scout", name: "Goblin Scout", level: 3, hp: 65, attack: 10, defense: 3,
    xpReward: 40, goldDrop: [5, 15], respawnSeconds: 45, aggressive: true,
    lootTable: [{ itemTemplateId: 33, chance: 0.5 }, { itemTemplateId: 20, chance: 0.2 }],
  },
  green_slime: {
    id: "green_slime", name: "Green Slime", level: 2, hp: 45, attack: 6, defense: 5,
    xpReward: 22, goldDrop: [1, 6], respawnSeconds: 30, aggressive: false,
    lootTable: [],
  },
  bandit: {
    id: "bandit", name: "Bandit", level: 4, hp: 90, attack: 14, defense: 5,
    xpReward: 60, goldDrop: [8, 25], respawnSeconds: 90, aggressive: true,
    lootTable: [{ itemTemplateId: 20, chance: 0.3 }, { itemTemplateId: 10, chance: 0.1 }],
  },
  alpha_wolf: {
    id: "alpha_wolf", name: "Alpha Wolf", level: 5, hp: 180, attack: 20, defense: 8,
    xpReward: 120, goldDrop: [15, 40], respawnSeconds: 180, aggressive: true,
    lootTable: [{ itemTemplateId: 31, chance: 0.9 }, { itemTemplateId: 11, chance: 0.15 }],
  },

  // ── Wild Meadow (Levels 5-10) ──────────────────────────
  brown_bear: {
    id: "brown_bear", name: "Brown Bear", level: 6, hp: 220, attack: 25, defense: 12,
    xpReward: 180, goldDrop: [10, 30], respawnSeconds: 120, aggressive: false,
    lootTable: [{ itemTemplateId: 21, chance: 0.25 }],
  },
  giant_spider: {
    id: "giant_spider", name: "Giant Spider", level: 7, hp: 160, attack: 22, defense: 8,
    xpReward: 160, goldDrop: [8, 22], respawnSeconds: 90, aggressive: true,
    lootTable: [{ itemTemplateId: 34, chance: 0.6 }],
  },
  orc_warrior: {
    id: "orc_warrior", name: "Orc Warrior", level: 8, hp: 280, attack: 30, defense: 15,
    xpReward: 220, goldDrop: [20, 50], respawnSeconds: 120, aggressive: true,
    lootTable: [{ itemTemplateId: 12, chance: 0.1 }, { itemTemplateId: 21, chance: 0.3 }],
  },
  harpy: {
    id: "harpy", name: "Harpy", level: 9, hp: 200, attack: 28, defense: 10,
    xpReward: 200, goldDrop: [15, 40], respawnSeconds: 100, aggressive: true,
    lootTable: [],
  },

  // ── Dark Forest (Levels 10-16) ─────────────────────────
  shadow_stalker: {
    id: "shadow_stalker", name: "Shadow Stalker", level: 11, hp: 350, attack: 40, defense: 20,
    xpReward: 350, goldDrop: [30, 80], respawnSeconds: 150, aggressive: true,
    lootTable: [{ itemTemplateId: 35, chance: 0.4 }],
  },
  dark_knight: {
    id: "dark_knight", name: "Dark Knight", level: 13, hp: 500, attack: 55, defense: 30,
    xpReward: 500, goldDrop: [50, 120], respawnSeconds: 200, aggressive: true,
    lootTable: [{ itemTemplateId: 4, chance: 0.05 }, { itemTemplateId: 22, chance: 0.4 }],
  },
  necromancer: {
    id: "necromancer", name: "Necromancer", level: 16, hp: 800, attack: 70, defense: 25,
    xpReward: 1000, goldDrop: [100, 250], respawnSeconds: 600, aggressive: true,
    lootTable: [{ itemTemplateId: 35, chance: 0.8 }, { itemTemplateId: 13, chance: 0.1 }],
  },
};

// ============================================================
// NPC DEFINITIONS
// ============================================================

export const NPCS: Record<string, NPCDefinition> = {
  farmer_john: {
    id: "farmer_john", name: "Farmer John", role: "quest_giver",
    zone: "human_meadow", position: { x: 100, y: 100 },
    quests: ["rat_extermination", "wolf_hunter", "boar_bounty"],
    dialogue: "These pests are ruining my crops! Can you help?",
  },
  guard_captain: {
    id: "guard_captain", name: "Guard Captain Aldric", role: "quest_giver",
    zone: "human_meadow", position: { x: 200, y: 150 },
    quests: ["goblin_menace", "slime_cleanup", "bandit_problem", "alpha_threat"],
    dialogue: "The roads are dangerous. We need brave adventurers.",
  },
  merchant_gilda: {
    id: "merchant_gilda", name: "Merchant Gilda", role: "merchant",
    zone: "human_meadow", position: { x: 150, y: 120 },
    quests: [],
    shopInventory: [1, 5, 6, 10, 11, 20, 21],
    dialogue: "Fine wares for fine adventurers!",
  },
  ranger_elias: {
    id: "ranger_elias", name: "Ranger Elias", role: "quest_giver",
    zone: "wild_meadow", position: { x: 400, y: 300 },
    quests: ["bear_necessities", "arachnophobia", "orc_incursion"],
    dialogue: "The wild meadow grows more dangerous by the day.",
  },
  merchant_boris: {
    id: "merchant_boris", name: "Merchant Boris", role: "merchant",
    zone: "wild_meadow", position: { x: 420, y: 280 },
    quests: [],
    shopInventory: [2, 3, 11, 12, 21, 22],
    dialogue: "Better gear for tougher challenges.",
  },
  dark_oracle: {
    id: "dark_oracle", name: "The Dark Oracle", role: "quest_giver",
    zone: "dark_forest", position: { x: 700, y: 500 },
    quests: ["shadows_in_dark", "knight_slayer", "master_dark_forest"],
    dialogue: "Few venture here and fewer return...",
  },
};

// ============================================================
// PROPERTY DEFINITIONS
// ============================================================

export type PropertyTier = 1 | 2 | 3 | 4 | 5;
export const TIER_NAMES: Record<PropertyTier, string> = {
  1: "Cottage", 2: "House", 3: "Manor", 4: "Castle", 5: "Palace",
};

export interface PropertyDefinition {
  id:          string;
  name:        string;
  zone:        string;
  tier:        PropertyTier;
  priceGold:   number;   // purchase price in wog-gold
  rentPerTick: number;   // passive gold income per game tick (owner earns this)
  description: string;
  tokenId?:    number;   // set after on-chain mint
}

export const PROPERTIES: PropertyDefinition[] = [
  // ── Human Meadow ──────────────────────────────────────────
  { id: "meadow_cottage_1",  name: "Farmer's Cottage",       zone: "human_meadow", tier: 1, priceGold: 200,  rentPerTick: 3,  description: "A modest cottage beside the grain fields." },
  { id: "meadow_cottage_2",  name: "Riverside Cabin",         zone: "human_meadow", tier: 1, priceGold: 250,  rentPerTick: 4,  description: "Small cabin overlooking the eastern river." },
  { id: "meadow_house_1",    name: "Miller's House",          zone: "human_meadow", tier: 2, priceGold: 500,  rentPerTick: 9,  description: "A well-built two-story home with a watermill." },
  { id: "meadow_manor_1",    name: "Aldric's Manor",          zone: "human_meadow", tier: 3, priceGold: 1200, rentPerTick: 22, description: "Former home of the Guard Captain. Stone walls, iron gates." },

  // ── Wild Meadow ───────────────────────────────────────────
  { id: "wild_cottage_1",    name: "Ranger's Outpost",        zone: "wild_meadow",  tier: 1, priceGold: 350,  rentPerTick: 6,  description: "A scouting post at the edge of the wilds." },
  { id: "wild_house_1",      name: "Trapper's Lodge",         zone: "wild_meadow",  tier: 2, priceGold: 700,  rentPerTick: 13, description: "Thick walls keep the beasts out. Barely." },
  { id: "wild_house_2",      name: "Merchant Waystation",     zone: "wild_meadow",  tier: 2, priceGold: 800,  rentPerTick: 15, description: "Caravans stop here. Premium location." },
  { id: "wild_manor_1",      name: "Elias's Hunting Lodge",   zone: "wild_meadow",  tier: 3, priceGold: 1800, rentPerTick: 34, description: "The ranger's personal estate. Trophy room included." },

  // ── Dark Forest ───────────────────────────────────────────
  { id: "dark_house_1",      name: "Shadow Warden's Keep",    zone: "dark_forest",  tier: 2, priceGold: 1200, rentPerTick: 22, description: "Only the brave dare own property here." },
  { id: "dark_manor_1",      name: "Necromancer's Tower",     zone: "dark_forest",  tier: 3, priceGold: 3000, rentPerTick: 58, description: "Ominous. Expensive. Worth it." },
  { id: "dark_castle_1",     name: "Shadowgate Castle",       zone: "dark_forest",  tier: 4, priceGold: 6000, rentPerTick: 120,"description": "Controls the Dark Forest pass. Ultimate power property." },
];

// ============================================================
// ZONE DEFINITIONS
// ============================================================

export const ZONES: Record<string, ZoneDefinition> = {
  human_meadow: {
    id: "human_meadow",
    name: "Human Meadow",
    levelRange: [1, 5],
    description: "A peaceful meadow — or so it seems. Rats and wolves lurk nearby.",
    spawnPoints: [
      { x: 50, y: 50 }, { x: 80, y: 60 }, { x: 60, y: 80 },
    ],
    mobSpawns: [
      { templateId: "giant_rat",    position: { x: 120, y: 80  }, count: 5 },
      { templateId: "young_wolf",   position: { x: 180, y: 60  }, count: 3 },
      { templateId: "wild_boar",    position: { x: 250, y: 100 }, count: 3 },
      { templateId: "goblin_scout", position: { x: 300, y: 80  }, count: 4 },
      { templateId: "green_slime",  position: { x: 140, y: 160 }, count: 4 },
      { templateId: "bandit",       position: { x: 320, y: 140 }, count: 3 },
      { templateId: "alpha_wolf",   position: { x: 350, y: 50  }, count: 1 },
    ],
    npcs: ["farmer_john", "guard_captain", "merchant_gilda"],
    portals: [{ targetZone: "wild_meadow", position: { x: 380, y: 200 }, requiredLevel: 5 }],
    ambientMobs: ["giant_rat", "young_wolf", "green_slime"],
  },

  wild_meadow: {
    id: "wild_meadow",
    name: "Wild Meadow",
    levelRange: [5, 10],
    description: "Untamed wilderness. Bears, orcs and spiders claim this land.",
    spawnPoints: [
      { x: 400, y: 220 }, { x: 430, y: 240 },
    ],
    mobSpawns: [
      { templateId: "brown_bear",   position: { x: 480, y: 280 }, count: 3 },
      { templateId: "giant_spider", position: { x: 550, y: 300 }, count: 4 },
      { templateId: "orc_warrior",  position: { x: 600, y: 260 }, count: 3 },
      { templateId: "harpy",        position: { x: 520, y: 350 }, count: 3 },
    ],
    npcs: ["ranger_elias", "merchant_boris"],
    portals: [
      { targetZone: "human_meadow", position: { x: 400, y: 220 }, requiredLevel: 1 },
      { targetZone: "dark_forest",  position: { x: 650, y: 400 }, requiredLevel: 10 },
    ],
    ambientMobs: ["brown_bear", "giant_spider"],
  },

  dark_forest: {
    id: "dark_forest",
    name: "Dark Forest",
    levelRange: [10, 16],
    description: "An ancient forest of shadow. Only the strongest survive.",
    spawnPoints: [{ x: 670, y: 420 }],
    mobSpawns: [
      { templateId: "shadow_stalker", position: { x: 720, y: 460 }, count: 4 },
      { templateId: "dark_knight",    position: { x: 800, y: 500 }, count: 2 },
      { templateId: "necromancer",    position: { x: 850, y: 550 }, count: 1 },
    ],
    npcs: ["dark_oracle"],
    portals: [{ targetZone: "wild_meadow", position: { x: 670, y: 420 }, requiredLevel: 1 }],
    ambientMobs: ["shadow_stalker"],
  },
};
