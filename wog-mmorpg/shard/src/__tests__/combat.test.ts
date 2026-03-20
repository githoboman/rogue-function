import { describe, it, expect } from "vitest";
import { resolveCombat, calculateMaxHp, getLevel, xpToNextLevel, checkRespawn } from "../combat";
import type { Player, MobInstance } from "../zoneRuntime";

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: "test-player", name: "TestHero", class: "Warrior", race: "Human",
    level: 1, xp: 0, currentHp: 100, maxHp: 100,
    zone: "human_meadow", position: { x: 100, y: 100 }, zone_spawn: { x: 100, y: 100 },
    equippedAttackBonus: 0, equippedDefenseBonus: 0, inventory: [],
    respawnAt: null, lastSeen: Date.now(), gold: 0, wallet: "", characterTokenId: 0,
    ...overrides,
  };
}

function makeMob(overrides: Partial<MobInstance> = {}): MobInstance {
  return {
    id: "mob_1", templateId: "giant_rat", zone: "human_meadow",
    position: { x: 120, y: 120 }, currentHp: 20, maxHp: 20,
    deadUntil: null, targetPlayerId: null, spawnPosition: { x: 120, y: 120 },
    ...overrides,
  };
}

describe("Combat Engine", () => {
  it("should deal damage to mob", () => {
    const player = makePlayer();
    const mob = makeMob();
    const result = resolveCombat(player, mob);
    expect(result.playerDamageDealt).toBeGreaterThan(0);
    expect(result.mobHealth).toBeLessThan(20);
    expect(result.mobName).toBe("Giant Rat");
  });

  it("should kill mob when HP reaches 0", () => {
    const player = makePlayer({ level: 10 });
    const mob = makeMob({ currentHp: 1 });
    const result = resolveCombat(player, mob);
    expect(result.mobDied).toBe(true);
    expect(result.xpGained).toBeGreaterThan(0);
    expect(result.goldDropped).toBeGreaterThanOrEqual(0);
  });

  it("mob should counter-attack if alive", () => {
    const player = makePlayer();
    const mob = makeMob({ currentHp: 200, maxHp: 200 });
    const result = resolveCombat(player, mob);
    expect(result.mobDamageDealt).toBeGreaterThan(0);
    expect(result.playerHealth).toBeLessThan(100);
  });

  it("mob should not counter-attack if killed", () => {
    const player = makePlayer({ level: 15, equippedAttackBonus: 50 });
    const mob = makeMob({ currentHp: 1 });
    const result = resolveCombat(player, mob);
    expect(result.mobDied).toBe(true);
    expect(result.mobDamageDealt).toBe(0);
  });

  it("should drop loot on mob death", () => {
    const player = makePlayer({ level: 10, equippedAttackBonus: 50 });
    const mob = makeMob({ currentHp: 1 });
    // Run multiple times to get loot (probabilistic)
    let gotLoot = false;
    for (let i = 0; i < 50; i++) {
      const result = resolveCombat(player, makeMob({ currentHp: 1 }));
      if (result.loot.length > 0) { gotLoot = true; break; }
    }
    // Giant rat has loot table entries, so we should eventually get loot
    expect(gotLoot).toBe(true);
  });

  it("should detect player death", () => {
    const player = makePlayer({ currentHp: 1, maxHp: 100 });
    const mob = makeMob({ currentHp: 200, maxHp: 200, templateId: "dark_knight" });
    const result = resolveCombat(player, mob);
    // With 1 HP and a strong mob, player should die
    expect(result.playerDied).toBe(true);
    expect(result.playerHealth).toBe(0);
  });
});

describe("Leveling", () => {
  it("should return level 1 for 0 XP", () => {
    expect(getLevel(0)).toBe(1);
  });

  it("should return level 2 for 300 XP", () => {
    expect(getLevel(300)).toBe(2);
  });

  it("should return level 3 for 700 XP", () => {
    expect(getLevel(700)).toBe(3);
  });

  it("should calculate XP to next level", () => {
    expect(xpToNextLevel(0)).toBe(300);    // Level 1 → 2
    expect(xpToNextLevel(300)).toBe(400);  // Level 2 → 3 (700 - 300)
    expect(xpToNextLevel(150)).toBe(150);  // Level 1 → 2 (300 - 150)
  });
});

describe("Max HP Calculation", () => {
  it("should scale with level", () => {
    const hp1 = calculateMaxHp(1, "Warrior");
    const hp10 = calculateMaxHp(10, "Warrior");
    expect(hp10).toBeGreaterThan(hp1);
  });

  it("should vary by class", () => {
    const warrior = calculateMaxHp(5, "Warrior");
    const mage = calculateMaxHp(5, "Mage");
    expect(warrior).toBeGreaterThan(mage); // Warriors have higher HP mult
  });
});

describe("Respawn", () => {
  it("should respawn player after timer expires", () => {
    const player = makePlayer({ currentHp: 0, respawnAt: Date.now() - 1000, maxHp: 100 });
    const respawned = checkRespawn(player);
    expect(respawned).toBe(true);
    expect(player.currentHp).toBeGreaterThan(0);
    expect(player.respawnAt).toBeNull();
  });

  it("should not respawn before timer", () => {
    const player = makePlayer({ currentHp: 0, respawnAt: Date.now() + 10000 });
    const respawned = checkRespawn(player);
    expect(respawned).toBe(false);
    expect(player.currentHp).toBe(0);
  });
});
