import { describe, it, expect, beforeEach } from "vitest";
import { ZoneRuntime } from "../zoneRuntime";

let runtime: ZoneRuntime;

beforeEach(() => {
  runtime = new ZoneRuntime();
});

describe("ZoneRuntime — Player Management", () => {
  it("should spawn a player", () => {
    const player = runtime.spawnPlayer({
      id: "p1", name: "Hero", class: "Warrior", race: "Human",
      zone: "human_meadow", wallet: "", characterTokenId: 0,
    });
    expect(player.id).toBe("p1");
    expect(player.name).toBe("Hero");
    expect(player.level).toBe(1);
    expect(player.currentHp).toBeGreaterThan(0);
    expect(runtime.players.has("p1")).toBe(true);
  });

  it("should place player in correct zone", () => {
    runtime.spawnPlayer({
      id: "p1", name: "Hero", class: "Warrior", race: "Human",
      zone: "human_meadow", wallet: "", characterTokenId: 0,
    });
    const zone = runtime.zones.get("human_meadow");
    expect(zone?.players.has("p1")).toBe(true);
  });

  it("should move player between zones", () => {
    const player = runtime.spawnPlayer({
      id: "p1", name: "Hero", class: "Warrior", race: "Human",
      zone: "human_meadow", wallet: "", characterTokenId: 0,
    });
    player.level = 5; // wild_meadow requires level >= 3 (levelRange[0] - 2)
    const moved = runtime.movePlayerToZone("p1", "wild_meadow");
    expect(moved).toBe(true);
    expect(runtime.players.get("p1")?.zone).toBe("wild_meadow");
    expect(runtime.zones.get("human_meadow")?.players.has("p1")).toBe(false);
    expect(runtime.zones.get("wild_meadow")?.players.has("p1")).toBe(true);
  });

  it("should not move to nonexistent zone", () => {
    runtime.spawnPlayer({
      id: "p1", name: "Hero", class: "Warrior", race: "Human",
      zone: "human_meadow", wallet: "", characterTokenId: 0,
    });
    const moved = runtime.movePlayerToZone("p1", "fake_zone");
    expect(moved).toBe(false);
  });
});

describe("ZoneRuntime — Combat", () => {
  it("should handle attack on nearby mob", () => {
    runtime.spawnPlayer({
      id: "p1", name: "Hero", class: "Warrior", race: "Human",
      zone: "human_meadow", wallet: "", characterTokenId: 0,
    });

    // Find a mob in human_meadow
    const zone = runtime.zones.get("human_meadow")!;
    const firstMob = [...zone.mobs.values()][0];
    expect(firstMob).toBeDefined();

    const result = runtime.handleAttack("p1", firstMob.id);
    expect(result.error).toBeUndefined();
    expect(result.playerDamageDealt).toBeGreaterThan(0);
  });

  it("should reject attack on dead player", () => {
    const player = runtime.spawnPlayer({
      id: "p1", name: "Hero", class: "Warrior", race: "Human",
      zone: "human_meadow", wallet: "", characterTokenId: 0,
    });
    player.currentHp = 0;

    const zone = runtime.zones.get("human_meadow")!;
    const mob = [...zone.mobs.values()][0];
    const result = runtime.handleAttack("p1", mob.id);
    expect(result.error).toBe("Player is dead");
  });

  it("should reject attack on nonexistent mob", () => {
    runtime.spawnPlayer({
      id: "p1", name: "Hero", class: "Warrior", race: "Human",
      zone: "human_meadow", wallet: "", characterTokenId: 0,
    });
    const result = runtime.handleAttack("p1", "fake_mob_999");
    expect(result.error).toBe("Mob not available");
  });
});

describe("ZoneRuntime — Inventory", () => {
  it("should add items to inventory", () => {
    const player = runtime.spawnPlayer({
      id: "p1", name: "Hero", class: "Warrior", race: "Human",
      zone: "human_meadow", wallet: "", characterTokenId: 0,
    });
    runtime.addToInventory(player, 20, 3); // 3x Minor Health Potion
    expect(player.inventory.length).toBe(1);
    expect(player.inventory[0].name).toBe("Minor Health Potion");
    expect(player.inventory[0].quantity).toBe(3);
  });

  it("should stack potions", () => {
    const player = runtime.spawnPlayer({
      id: "p1", name: "Hero", class: "Warrior", race: "Human",
      zone: "human_meadow", wallet: "", characterTokenId: 0,
    });
    runtime.addToInventory(player, 20, 2);
    runtime.addToInventory(player, 20, 3);
    expect(player.inventory.length).toBe(1);
    expect(player.inventory[0].quantity).toBe(5);
  });

  it("should use potions and restore HP", () => {
    const player = runtime.spawnPlayer({
      id: "p1", name: "Hero", class: "Warrior", race: "Human",
      zone: "human_meadow", wallet: "", characterTokenId: 0,
    });
    player.currentHp = 10;
    runtime.addToInventory(player, 20, 1);
    const tokenId = player.inventory[0].tokenId;
    const result = runtime.handleUseItem("p1", tokenId);
    expect(result.success).toBe(true);
    expect(result.hpRestored).toBeGreaterThan(0);
    expect(player.currentHp).toBeGreaterThan(10);
  });
});

describe("ZoneRuntime — State Queries", () => {
  it("should return player state", () => {
    runtime.spawnPlayer({
      id: "p1", name: "Hero", class: "Warrior", race: "Human",
      zone: "human_meadow", wallet: "ST123", characterTokenId: 1,
    });
    const state = runtime.getPlayerState("p1");
    expect(state).not.toBeNull();
    expect(state.playerId).toBe("p1");
    expect(state.zone).toBe("human_meadow");
    expect(state.nearbyEntities.length).toBeGreaterThan(0);
    expect(state.characterTokenId).toBe(1);
  });

  it("should return batch state", () => {
    runtime.spawnPlayer({ id: "p1", name: "A", class: "Warrior", race: "Human", zone: "human_meadow", wallet: "", characterTokenId: 0 });
    runtime.spawnPlayer({ id: "p2", name: "B", class: "Mage", race: "Human", zone: "human_meadow", wallet: "", characterTokenId: 0 });
    const batch = runtime.getBatchState(["p1", "p2", "p3"]);
    expect(Object.keys(batch)).toEqual(["p1", "p2"]);
  });

  it("should return full world snapshot", () => {
    runtime.spawnPlayer({ id: "p1", name: "A", class: "Warrior", race: "Human", zone: "human_meadow", wallet: "", characterTokenId: 0 });
    const snap = runtime.getFullWorldSnapshot();
    expect(snap.totalPlayers).toBe(1);
    expect(snap.zones.human_meadow).toBeDefined();
    expect(snap.agents.length).toBe(1);
  });
});
