/**
 * questSystem.ts — Quest Chain System
 * 20 quests across 3 zones with prerequisites and chain logic
 */

import { Player } from "./zoneRuntime";

// ============================================================
// TYPES
// ============================================================

export interface QuestDefinition {
  id: string;
  name: string;
  zone: string;
  giverNpcId: string;
  description: string;
  objective: KillObjective | CollectObjective;
  prerequisiteQuests: string[];  // must complete these first
  requiredLevel: number;
  goldReward: number;
  xpReward: number;
  itemRewards: number[];         // item template IDs
  nextQuestId?: string;          // unlocks this quest on completion
}

interface KillObjective {
  type: "kill";
  mobTemplateId: string;
  mobName: string;
  count: number;
}

interface CollectObjective {
  type: "collect";
  itemTemplateId: number;
  itemName: string;
  count: number;
}

export interface QuestProgress {
  questId: string;
  playerId: string;
  status: "active" | "completed" | "failed";
  currentCount: number;
  acceptedAt: number;
  completedAt?: number;
}

// ============================================================
// ALL 20 QUESTS
// ============================================================

export const QUESTS: Record<string, QuestDefinition> = {

  // ══ HUMAN MEADOW CHAIN (Quests 1-7) ══════════════════════

  rat_extermination: {
    id: "rat_extermination", name: "Rat Extermination",
    zone: "human_meadow", giverNpcId: "farmer_john",
    description: "Giant rats are destroying Farmer John's crops.",
    objective: { type: "kill", mobTemplateId: "giant_rat", mobName: "Giant Rat", count: 8 },
    prerequisiteQuests: [], requiredLevel: 1,
    goldReward: 50, xpReward: 100, itemRewards: [20],
    nextQuestId: "wolf_hunter",
  },

  wolf_hunter: {
    id: "wolf_hunter", name: "Wolf Hunter",
    zone: "human_meadow", giverNpcId: "farmer_john",
    description: "Wolves have been preying on livestock. Thin their numbers.",
    objective: { type: "kill", mobTemplateId: "young_wolf", mobName: "Young Wolf", count: 6 },
    prerequisiteQuests: ["rat_extermination"], requiredLevel: 2,
    goldReward: 80, xpReward: 160, itemRewards: [],
    nextQuestId: "boar_bounty",
  },

  boar_bounty: {
    id: "boar_bounty", name: "Boar Bounty",
    zone: "human_meadow", giverNpcId: "farmer_john",
    description: "Wild boars are charging through the fields.",
    objective: { type: "kill", mobTemplateId: "wild_boar", mobName: "Wild Boar", count: 5 },
    prerequisiteQuests: ["wolf_hunter"], requiredLevel: 2,
    goldReward: 100, xpReward: 200, itemRewards: [],
    nextQuestId: "goblin_menace",
  },

  goblin_menace: {
    id: "goblin_menace", name: "Goblin Menace",
    zone: "human_meadow", giverNpcId: "guard_captain",
    description: "Goblin scouts are raiding the village outskirts.",
    objective: { type: "kill", mobTemplateId: "goblin_scout", mobName: "Goblin Scout", count: 8 },
    prerequisiteQuests: ["boar_bounty"], requiredLevel: 3,
    goldReward: 120, xpReward: 250, itemRewards: [20],
    nextQuestId: "slime_cleanup",
  },

  slime_cleanup: {
    id: "slime_cleanup", name: "Slime Cleanup",
    zone: "human_meadow", giverNpcId: "guard_captain",
    description: "Slimes are blocking the trade roads.",
    objective: { type: "kill", mobTemplateId: "green_slime", mobName: "Green Slime", count: 10 },
    prerequisiteQuests: ["goblin_menace"], requiredLevel: 3,
    goldReward: 100, xpReward: 200, itemRewards: [],
    nextQuestId: "bandit_problem",
  },

  bandit_problem: {
    id: "bandit_problem", name: "Bandit Problem",
    zone: "human_meadow", giverNpcId: "guard_captain",
    description: "Bandits are robbing merchants on the King's Road.",
    objective: { type: "kill", mobTemplateId: "bandit", mobName: "Bandit", count: 6 },
    prerequisiteQuests: ["slime_cleanup"], requiredLevel: 4,
    goldReward: 175, xpReward: 350, itemRewards: [21],
    nextQuestId: "alpha_threat",
  },

  alpha_threat: {
    id: "alpha_threat", name: "The Alpha Threat",
    zone: "human_meadow", giverNpcId: "guard_captain",
    description: "A massive Alpha Wolf leads the pack threatening the meadow.",
    objective: { type: "kill", mobTemplateId: "alpha_wolf", mobName: "Alpha Wolf", count: 1 },
    prerequisiteQuests: ["bandit_problem"], requiredLevel: 5,
    goldReward: 300, xpReward: 600, itemRewards: [11],
    nextQuestId: "bear_necessities",
  },

  // ══ WILD MEADOW CHAIN (Quests 8-14) ══════════════════════

  bear_necessities: {
    id: "bear_necessities", name: "Bear Necessities",
    zone: "wild_meadow", giverNpcId: "ranger_elias",
    description: "Brown bears are blocking the path deeper into the wild.",
    objective: { type: "kill", mobTemplateId: "brown_bear", mobName: "Brown Bear", count: 4 },
    prerequisiteQuests: ["alpha_threat"], requiredLevel: 5,
    goldReward: 250, xpReward: 500, itemRewards: [],
    nextQuestId: "arachnophobia",
  },

  arachnophobia: {
    id: "arachnophobia", name: "Arachnophobia",
    zone: "wild_meadow", giverNpcId: "ranger_elias",
    description: "Giant spiders have nested near the ranger camp.",
    objective: { type: "kill", mobTemplateId: "giant_spider", mobName: "Giant Spider", count: 6 },
    prerequisiteQuests: ["bear_necessities"], requiredLevel: 6,
    goldReward: 300, xpReward: 600, itemRewards: [21],
    nextQuestId: "silk_collector",
  },

  silk_collector: {
    id: "silk_collector", name: "Silk Collector",
    zone: "wild_meadow", giverNpcId: "merchant_boris",
    description: "Collect spider silk for crafting premium goods.",
    objective: { type: "collect", itemTemplateId: 34, itemName: "Spider Silk", count: 5 },
    prerequisiteQuests: ["arachnophobia"], requiredLevel: 7,
    goldReward: 350, xpReward: 500, itemRewards: [12],
    nextQuestId: "orc_incursion",
  },

  orc_incursion: {
    id: "orc_incursion", name: "Orc Incursion",
    zone: "wild_meadow", giverNpcId: "ranger_elias",
    description: "Orc warriors are pushing into human territory.",
    objective: { type: "kill", mobTemplateId: "orc_warrior", mobName: "Orc Warrior", count: 5 },
    prerequisiteQuests: ["silk_collector"], requiredLevel: 8,
    goldReward: 400, xpReward: 800, itemRewards: [],
    nextQuestId: "harpy_menace",
  },

  harpy_menace: {
    id: "harpy_menace", name: "Harpy Menace",
    zone: "wild_meadow", giverNpcId: "ranger_elias",
    description: "Harpies are attacking travellers from the sky.",
    objective: { type: "kill", mobTemplateId: "harpy", mobName: "Harpy", count: 5 },
    prerequisiteQuests: ["orc_incursion"], requiredLevel: 9,
    goldReward: 450, xpReward: 900, itemRewards: [22],
    nextQuestId: "shadows_in_dark",
  },

  wild_meadow_cleanse: {
    id: "wild_meadow_cleanse", name: "Cleansing the Wild",
    zone: "wild_meadow", giverNpcId: "ranger_elias",
    description: "Purge the strongest monsters from the wild meadow.",
    objective: { type: "kill", mobTemplateId: "orc_warrior", mobName: "Orc Warrior", count: 8 },
    prerequisiteQuests: ["harpy_menace"], requiredLevel: 9,
    goldReward: 500, xpReward: 1000, itemRewards: [3],
    nextQuestId: "shadows_in_dark",
  },

  // ══ DARK FOREST CHAIN (Quests 15-20) ═════════════════════

  shadows_in_dark: {
    id: "shadows_in_dark", name: "Shadows in the Dark",
    zone: "dark_forest", giverNpcId: "dark_oracle",
    description: "Shadow Stalkers lurk in the darkness, hunting everything.",
    objective: { type: "kill", mobTemplateId: "shadow_stalker", mobName: "Shadow Stalker", count: 5 },
    prerequisiteQuests: ["wild_meadow_cleanse"], requiredLevel: 10,
    goldReward: 600, xpReward: 1200, itemRewards: [],
    nextQuestId: "shadow_essence_hunt",
  },

  shadow_essence_hunt: {
    id: "shadow_essence_hunt", name: "Shadow Essence",
    zone: "dark_forest", giverNpcId: "dark_oracle",
    description: "Harvest shadow essence from the stalkers.",
    objective: { type: "collect", itemTemplateId: 35, itemName: "Shadow Essence", count: 5 },
    prerequisiteQuests: ["shadows_in_dark"], requiredLevel: 11,
    goldReward: 700, xpReward: 1400, itemRewards: [22],
    nextQuestId: "knight_slayer",
  },

  knight_slayer: {
    id: "knight_slayer", name: "Knight Slayer",
    zone: "dark_forest", giverNpcId: "dark_oracle",
    description: "Dark Knights enforce the Necromancer's will. End them.",
    objective: { type: "kill", mobTemplateId: "dark_knight", mobName: "Dark Knight", count: 3 },
    prerequisiteQuests: ["shadow_essence_hunt"], requiredLevel: 12,
    goldReward: 900, xpReward: 1800, itemRewards: [13],
    nextQuestId: "knight_commander",
  },

  knight_commander: {
    id: "knight_commander", name: "Commander of Darkness",
    zone: "dark_forest", giverNpcId: "dark_oracle",
    description: "The Knight Commander leads the dark forces.",
    objective: { type: "kill", mobTemplateId: "dark_knight", mobName: "Dark Knight", count: 5 },
    prerequisiteQuests: ["knight_slayer"], requiredLevel: 14,
    goldReward: 1100, xpReward: 2200, itemRewards: [4],
    nextQuestId: "master_dark_forest",
  },

  master_dark_forest: {
    id: "master_dark_forest", name: "Master of the Dark Forest",
    zone: "dark_forest", giverNpcId: "dark_oracle",
    description: "Slay the Necromancer and cleanse the Dark Forest forever.",
    objective: { type: "kill", mobTemplateId: "necromancer", mobName: "Necromancer", count: 1 },
    prerequisiteQuests: ["knight_commander"], requiredLevel: 15,
    goldReward: 2000, xpReward: 5000, itemRewards: [4, 13, 22],
    nextQuestId: undefined,
  },
};

// ============================================================
// QUEST MANAGER CLASS
// ============================================================

export class QuestManager {
  // playerId → questId → QuestProgress
  private progress: Map<string, Map<string, QuestProgress>> = new Map();

  // ── Available Quests ──────────────────────────────────────

  getAvailableQuests(player: Player, zoneId: string, npcId: string): QuestDefinition[] {
    const completed = this.getCompletedQuestIds(player.id);
    const active    = this.getActiveQuestIds(player.id);

    return Object.values(QUESTS).filter(q => {
      if (q.zone !== zoneId) return false;
      if (q.giverNpcId !== npcId) return false;
      if (active.has(q.id)) return false;       // already active
      if (completed.has(q.id)) return false;    // already done
      if (player.level < q.requiredLevel) return false;
      // Check prerequisites
      return q.prerequisiteQuests.every(prereqId => completed.has(prereqId));
    });
  }

  // ── Accept Quest ──────────────────────────────────────────

  acceptQuest(playerId: string, questId: string): { success: boolean; message: string; questName?: string } {
    const quest = QUESTS[questId];
    if (!quest) return { success: false, message: "Quest not found" };

    const playerProgress = this.getPlayerProgress(playerId);
    if (playerProgress.has(questId)) {
      return { success: false, message: "Quest already active or completed" };
    }

    playerProgress.set(questId, {
      questId,
      playerId,
      status: "active",
      currentCount: 0,
      acceptedAt: Date.now(),
    });

    return { success: true, message: "Quest accepted", questName: quest.name };
  }

  // ── Record Kill/Collect Progress ──────────────────────────

  recordKill(playerId: string, mobTemplateId: string): string[] {
    const completed: string[] = [];
    const playerProgress = this.getPlayerProgress(playerId);

    for (const [questId, progress] of playerProgress.entries()) {
      if (progress.status !== "active") continue;

      const quest = QUESTS[questId];
      if (!quest || quest.objective.type !== "kill") continue;
      if ((quest.objective as any).mobTemplateId !== mobTemplateId) continue;

      progress.currentCount++;

      if (progress.currentCount >= (quest.objective as any).count) {
        completed.push(questId);
      }
    }

    return completed; // returns quest IDs that are now ready to complete
  }

  recordCollect(playerId: string, itemTemplateId: number, quantity: number): string[] {
    const readyToComplete: string[] = [];
    const playerProgress = this.getPlayerProgress(playerId);

    for (const [questId, progress] of playerProgress.entries()) {
      if (progress.status !== "active") continue;

      const quest = QUESTS[questId];
      if (!quest || quest.objective.type !== "collect") continue;
      if ((quest.objective as any).itemTemplateId !== itemTemplateId) continue;

      progress.currentCount = Math.min(
        progress.currentCount + quantity,
        (quest.objective as any).count
      );

      if (progress.currentCount >= (quest.objective as any).count) {
        readyToComplete.push(questId);
      }
    }

    return readyToComplete;
  }

  // ── Complete Quest ────────────────────────────────────────

  completeQuest(playerId: string, questId: string): {
    success: boolean;
    message: string;
    rewards?: { goldReward: number; xpReward: number; itemRewards: number[] };
    unlockedQuestId?: string;
  } {
    const quest = QUESTS[questId];
    if (!quest) return { success: false, message: "Quest not found" };

    const playerProgress = this.getPlayerProgress(playerId);
    const progress = playerProgress.get(questId);

    if (!progress || progress.status !== "active") {
      return { success: false, message: "Quest not active" };
    }

    const required = (quest.objective as any).count;
    if (progress.currentCount < required) {
      return {
        success: false,
        message: `Objective incomplete: ${progress.currentCount}/${required}`,
      };
    }

    progress.status = "completed";
    progress.completedAt = Date.now();

    return {
      success: true,
      message: `Quest "${quest.name}" completed!`,
      rewards: {
        goldReward: quest.goldReward,
        xpReward: quest.xpReward,
        itemRewards: quest.itemRewards,
      },
      unlockedQuestId: quest.nextQuestId,
    };
  }

  // ── Getters ───────────────────────────────────────────────

  getActiveQuests(playerId: string): (QuestDefinition & { progress: QuestProgress })[] {
    const playerProgress = this.getPlayerProgress(playerId);
    const result = [];

    for (const [questId, prog] of playerProgress.entries()) {
      if (prog.status !== "active") continue;
      const quest = QUESTS[questId];
      if (quest) result.push({ ...quest, progress: prog });
    }

    return result;
  }

  getQuestProgress(playerId: string, questId: string): QuestProgress | null {
    return this.getPlayerProgress(playerId).get(questId) || null;
  }

  getCompletedCount(playerId: string): number {
    return this.getCompletedQuestIds(playerId).size;
  }

  getCompletedQuestIds(playerId: string): Set<string> {
    const playerProgress = this.getPlayerProgress(playerId);
    const completed = new Set<string>();
    for (const [id, p] of playerProgress.entries()) {
      if (p.status === "completed") completed.add(id);
    }
    return completed;
  }

  private getActiveQuestIds(playerId: string): Set<string> {
    const playerProgress = this.getPlayerProgress(playerId);
    const active = new Set<string>();
    for (const [id, p] of playerProgress.entries()) {
      if (p.status === "active") active.add(id);
    }
    return active;
  }

  private getPlayerProgress(playerId: string): Map<string, QuestProgress> {
    if (!this.progress.has(playerId)) {
      this.progress.set(playerId, new Map());
    }
    return this.progress.get(playerId)!;
  }
}
