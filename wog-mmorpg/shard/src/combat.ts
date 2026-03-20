/**
 * combat.ts — Combat Engine
 * Damage calculation, death mechanics, respawn, loot drops
 */

import { MOB_TEMPLATES, ITEM_TEMPLATES, MobTemplate } from "./worldData";
import { Player, MobInstance } from "./zoneRuntime";

// ============================================================
// CONSTANTS
// ============================================================

const BASE_CRIT_CHANCE = 0.05;     // 5% base crit
const CRIT_MULTIPLIER  = 1.75;
const LEVEL_DAMAGE_SCALE = 0.08;   // 8% more damage per level above mob

// Class stat multipliers
const CLASS_STATS: Record<string, { atkMult: number; defMult: number; hpMult: number }> = {
  Warrior:     { atkMult: 1.2,  defMult: 1.3,  hpMult: 1.4  },
  Mage:        { atkMult: 1.4,  defMult: 0.7,  hpMult: 0.8  },
  Ranger:      { atkMult: 1.1,  defMult: 0.9,  hpMult: 1.0  },
  Cleric:      { atkMult: 0.8,  defMult: 1.1,  hpMult: 1.2  },
  Rogue:       { atkMult: 1.3,  defMult: 0.8,  hpMult: 0.9  },
  Paladin:     { atkMult: 1.0,  defMult: 1.4,  hpMult: 1.3  },
  Necromancer: { atkMult: 1.3,  defMult: 0.6,  hpMult: 0.9  },
  Druid:       { atkMult: 0.9,  defMult: 1.0,  hpMult: 1.1  },
};

// ============================================================
// TYPES
// ============================================================

export interface CombatResult {
  playerDamageDealt: number;
  mobDamageDealt: number;
  playerCrit: boolean;
  mobCrit: boolean;
  mobDied: boolean;
  playerDied: boolean;
  playerHealth: number;
  mobHealth: number;
  mobName: string;
  xpGained: number;
  goldDropped: number;
  loot: LootDrop[];
  combatLog: string[];
}

export interface LootDrop {
  itemTemplateId: number;
  itemName: string;
  quantity: number;
}

// ============================================================
// COMBAT RESOLUTION — one attack tick
// ============================================================

export function resolveCombat(player: Player, mob: MobInstance): CombatResult {
  const template = MOB_TEMPLATES[mob.templateId];
  const log: string[] = [];

  // ── Player attacks mob ────────────────────────────────
  const playerAtk = calculatePlayerAttack(player);
  const mobDef    = template.defense;
  const isCrit    = Math.random() < (BASE_CRIT_CHANCE + player.level * 0.002);
  let playerDmg   = Math.max(1, playerAtk - mobDef + randInt(-2, 2));
  if (isCrit) playerDmg = Math.floor(playerDmg * CRIT_MULTIPLIER);

  mob.currentHp = Math.max(0, mob.currentHp - playerDmg);
  log.push(`${player.name} hits ${template.name} for ${playerDmg}${isCrit ? " (CRIT!)" : ""}`);

  // ── Mob attacks player (if still alive) ───────────────
  let mobDmg = 0;
  let mobCrit = false;
  if (mob.currentHp > 0) {
    const playerDef = calculatePlayerDefense(player);
    mobCrit = Math.random() < 0.04;
    mobDmg  = Math.max(1, template.attack - playerDef + randInt(-2, 2));
    if (mobCrit) mobDmg = Math.floor(mobDmg * CRIT_MULTIPLIER);
    player.currentHp = Math.max(0, player.currentHp - mobDmg);
    log.push(`${template.name} hits ${player.name} for ${mobDmg}${mobCrit ? " (CRIT!)" : ""}`);
  }

  // ── Death resolution ──────────────────────────────────
  const mobDied    = mob.currentHp <= 0;
  const playerDied = player.currentHp <= 0;

  let xpGained   = 0;
  let goldDropped = 0;
  const loot: LootDrop[] = [];

  if (mobDied) {
    xpGained    = calculateXPGain(player.level, template);
    goldDropped = randInt(template.goldDrop[0], template.goldDrop[1]);

    // Loot drops
    for (const drop of template.lootTable) {
      if (Math.random() < drop.chance) {
        const item = ITEM_TEMPLATES[drop.itemTemplateId];
        if (item) {
          loot.push({ itemTemplateId: item.id, itemName: item.name, quantity: 1 });
        }
      }
    }

    log.push(`${template.name} dies! +${xpGained} XP, +${goldDropped} gold`);

    // Schedule respawn
    mob.deadUntil = Date.now() + template.respawnSeconds * 1000;
  }

  if (playerDied) {
    log.push(`${player.name} has been slain! Respawning...`);
    scheduleRespawn(player);
  }

  return {
    playerDamageDealt: playerDmg,
    mobDamageDealt: mobDmg,
    playerCrit: isCrit,
    mobCrit,
    mobDied,
    playerDied,
    playerHealth: player.currentHp,
    mobHealth: mob.currentHp,
    mobName: template.name,
    xpGained,
    goldDropped,
    loot,
    combatLog: log,
  };
}

// ============================================================
// STAT CALCULATIONS
// ============================================================

function calculatePlayerAttack(player: Player): number {
  const classStats = CLASS_STATS[player.class] || CLASS_STATS.Warrior;
  const baseAtk    = 5 + player.level * 3;
  const gearAtk    = player.equippedAttackBonus;
  return Math.floor((baseAtk + gearAtk) * classStats.atkMult);
}

function calculatePlayerDefense(player: Player): number {
  const classStats = CLASS_STATS[player.class] || CLASS_STATS.Warrior;
  const baseDef    = 2 + player.level * 1.5;
  const gearDef    = player.equippedDefenseBonus;
  return Math.floor((baseDef + gearDef) * classStats.defMult);
}

export function calculateMaxHp(level: number, characterClass: string): number {
  const classStats = CLASS_STATS[characterClass] || CLASS_STATS.Warrior;
  return Math.floor((80 + level * 20) * classStats.hpMult);
}

function calculateXPGain(playerLevel: number, mob: MobTemplate): number {
  const levelDiff = playerLevel - mob.level;
  // Penalty for farming low-level mobs, bonus for killing above your level
  const multiplier = levelDiff >= 0
    ? Math.max(0.1, 1 - levelDiff * 0.1)
    : 1 + Math.abs(levelDiff) * LEVEL_DAMAGE_SCALE;
  return Math.floor(mob.xpReward * multiplier);
}

// ============================================================
// LEVELING
// ============================================================

// XP required to reach each level
const LEVEL_XP_TABLE: number[] = [
  0, 0, 300, 700, 1300, 2100, 3200, 4700, 6500, 9000,
  12000, 16000, 21000, 27000, 34000, 42000, 52000,
];

export function getLevel(xp: number): number {
  for (let lvl = LEVEL_XP_TABLE.length - 1; lvl >= 1; lvl--) {
    if (xp >= LEVEL_XP_TABLE[lvl]) return lvl;
  }
  return 1;
}

export function xpToNextLevel(currentXp: number): number {
  const level = getLevel(currentXp);
  if (level >= LEVEL_XP_TABLE.length - 1) return 0;
  return LEVEL_XP_TABLE[level + 1] - currentXp;
}

// ============================================================
// RESPAWN
// ============================================================

function scheduleRespawn(player: Player): void {
  // Find graveyard spawn point for zone
  player.respawnAt = Date.now() + 5000; // 5 second death timer
  player.currentHp = 0;
}

export function checkRespawn(player: Player): boolean {
  if (player.respawnAt && Date.now() >= player.respawnAt) {
    player.currentHp = Math.floor(calculateMaxHp(player.level, player.class) * 0.5);
    player.respawnAt = null;
    // Move to zone spawn point
    player.position = { ...player.zone_spawn };
    return true;
  }
  return false;
}

// ============================================================
// HELPERS
// ============================================================

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
