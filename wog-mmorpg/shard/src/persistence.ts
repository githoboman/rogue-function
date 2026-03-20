/**
 * persistence.ts — JSON file-based game state persistence
 * Auto-saves player state periodically and on graceful shutdown.
 * Restores state on server restart.
 */

import * as fs from "fs";
import * as path from "path";
import { GameConfig } from "./config";

export interface SavedPlayerState {
  id: string;
  name: string;
  class: string;
  race: string;
  level: number;
  xp: number;
  currentHp: number;
  maxHp: number;
  zone: string;
  position: { x: number; y: number };
  gold: number;
  wallet: string;
  characterTokenId: number;
  inventory: any[];
  equippedAttackBonus: number;
  equippedDefenseBonus: number;
}

export interface SavedQuestState {
  playerId: string;
  activeQuests: any[];
  completedQuests: string[];
}

export interface GameSaveData {
  version: 1;
  savedAt: string;
  players: SavedPlayerState[];
  quests: SavedQuestState[];
}

const SAVE_PATH = path.resolve(GameConfig.SAVE_FILE);

export function saveGameState(players: Map<string, any>, questManager: any): void {
  const data: GameSaveData = {
    version: 1,
    savedAt: new Date().toISOString(),
    players: [...players.values()].map(p => ({
      id: p.id,
      name: p.name,
      class: p.class,
      race: p.race,
      level: p.level,
      xp: p.xp,
      currentHp: p.currentHp,
      maxHp: p.maxHp,
      zone: p.zone,
      position: { ...p.position },
      gold: p.gold,
      wallet: p.wallet,
      characterTokenId: p.characterTokenId,
      inventory: p.inventory.map((i: any) => ({ ...i })),
      equippedAttackBonus: p.equippedAttackBonus,
      equippedDefenseBonus: p.equippedDefenseBonus,
    })),
    quests: [...players.keys()].map(pid => ({
      playerId: pid,
      activeQuests: questManager.getActiveQuests(pid),
      completedQuests: questManager.getCompletedQuestIds?.(pid) || [],
    })),
  };

  try {
    // Write atomically: write to temp file first, then rename
    const tmpPath = SAVE_PATH + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, SAVE_PATH);
    console.log(`💾 Game state saved (${data.players.length} players)`);
  } catch (err: any) {
    console.error(`❌ Save failed: ${err.message}`);
  }
}

export function loadGameState(): GameSaveData | null {
  try {
    if (!fs.existsSync(SAVE_PATH)) return null;
    const raw = fs.readFileSync(SAVE_PATH, "utf-8");
    const data = JSON.parse(raw) as GameSaveData;
    if (data.version !== 1) {
      console.warn("⚠️  Unknown save version, skipping restore");
      return null;
    }
    console.log(`📂 Loaded save from ${data.savedAt} (${data.players.length} players)`);
    return data;
  } catch (err: any) {
    console.warn(`⚠️  Could not load save: ${err.message}`);
    return null;
  }
}

export function startAutoSave(players: Map<string, any>, questManager: any): NodeJS.Timeout {
  const interval = setInterval(() => {
    if (players.size > 0) {
      saveGameState(players, questManager);
    }
  }, GameConfig.SAVE_INTERVAL_MS);

  // Save on graceful shutdown
  const shutdown = () => {
    if (players.size > 0) saveGameState(players, questManager);
    clearInterval(interval);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return interval;
}
