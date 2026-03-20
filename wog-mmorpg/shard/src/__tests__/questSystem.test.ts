import { describe, it, expect, beforeEach } from "vitest";
import { QuestManager } from "../questSystem";
import type { Player } from "../zoneRuntime";

let qm: QuestManager;

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: "p1", name: "Hero", class: "Warrior", race: "Human",
    level: 1, xp: 0, currentHp: 100, maxHp: 100,
    zone: "human_meadow", position: { x: 100, y: 100 }, zone_spawn: { x: 100, y: 100 },
    equippedAttackBonus: 0, equippedDefenseBonus: 0, inventory: [],
    respawnAt: null, lastSeen: Date.now(), gold: 0, wallet: "", characterTokenId: 0,
    ...overrides,
  };
}

beforeEach(() => {
  qm = new QuestManager();
});

describe("QuestManager", () => {
  it("should list available quests for human meadow", () => {
    const player = makePlayer();
    // npc_farmer_john is the quest giver in human_meadow
    const quests = qm.getAvailableQuests(player, "human_meadow", "farmer_john");
    expect(quests.length).toBeGreaterThan(0);
    expect(quests[0].name).toBeDefined();
  });

  it("should accept a quest", () => {
    const player = makePlayer();
    const quests = qm.getAvailableQuests(player, "human_meadow", "farmer_john");
    const firstQuest = quests[0];
    const result = qm.acceptQuest("p1", firstQuest.id);
    expect(result.success).toBe(true);
    expect(result.questName).toBeDefined();
  });

  it("should track active quests", () => {
    const player = makePlayer();
    const quests = qm.getAvailableQuests(player, "human_meadow", "farmer_john");
    qm.acceptQuest("p1", quests[0].id);
    const active = qm.getActiveQuests("p1");
    expect(active.length).toBe(1);
    expect(active[0].id).toBe(quests[0].id);
  });

  it("should record kills and track progress", () => {
    const player = makePlayer();
    const quests = qm.getAvailableQuests(player, "human_meadow", "farmer_john");
    const quest = quests[0]; // Rat Extermination — kill giant_rat
    qm.acceptQuest("p1", quest.id);

    // Record kills matching the quest objective
    for (let i = 0; i < 5; i++) {
      qm.recordKill("p1", "giant_rat");
    }

    const active = qm.getActiveQuests("p1");
    expect(active[0].progress.currentCount).toBeGreaterThan(0);
  });

  it("should not accept same quest twice", () => {
    const player = makePlayer();
    const quests = qm.getAvailableQuests(player, "human_meadow", "farmer_john");
    qm.acceptQuest("p1", quests[0].id);
    const result = qm.acceptQuest("p1", quests[0].id);
    expect(result.success).toBe(false);
  });

  it("should complete quest when objectives met", () => {
    const player = makePlayer();
    const quests = qm.getAvailableQuests(player, "human_meadow", "farmer_john");
    const quest = quests[0];
    qm.acceptQuest("p1", quest.id);

    // Fulfill objective
    for (let i = 0; i < 20; i++) {
      qm.recordKill("p1", "giant_rat");
    }

    const result = qm.completeQuest("p1", quest.id);
    expect(result.success).toBe(true);
    expect(result.rewards).toBeDefined();
    expect(result.rewards!.goldReward).toBeGreaterThan(0);
    expect(result.rewards!.xpReward).toBeGreaterThan(0);
  });

  it("should not complete quest before objectives met", () => {
    const player = makePlayer();
    const quests = qm.getAvailableQuests(player, "human_meadow", "farmer_john");
    qm.acceptQuest("p1", quests[0].id);
    const result = qm.completeQuest("p1", quests[0].id);
    expect(result.success).toBe(false);
  });

  it("should track completed count", () => {
    const player = makePlayer();
    const quests = qm.getAvailableQuests(player, "human_meadow", "farmer_john");
    qm.acceptQuest("p1", quests[0].id);
    for (let i = 0; i < 20; i++) qm.recordKill("p1", "giant_rat");
    qm.completeQuest("p1", quests[0].id);
    expect(qm.getCompletedCount("p1")).toBe(1);
  });
});
