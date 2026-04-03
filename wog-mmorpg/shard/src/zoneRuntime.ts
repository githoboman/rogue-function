/**
 * zoneRuntime.ts — Game World Runtime
 * Manages all live game state: players, mobs, zones
 * Runs a tick loop that updates mob AI, respawns, etc.
 */

import { ZONES, MOB_TEMPLATES, NPCS, ITEM_TEMPLATES, ZoneDefinition } from "./worldData";
import { resolveCombat, calculateMaxHp, getLevel, checkRespawn } from "./combat";
import { QuestManager } from "./questSystem";

// ============================================================
// TYPES (exported — used by server, combat, quests)
// ============================================================

export interface Player {
  id: string;                 // wallet address or UUID
  name: string;
  class: string;
  race: string;
  level: number;
  xp: number;
  currentHp: number;
  maxHp: number;
  zone: string;
  position: { x: number; y: number };
  zone_spawn: { x: number; y: number };
  equippedAttackBonus: number;
  equippedDefenseBonus: number;
  inventory: InventoryEntry[];
  respawnAt: number | null;
  lastSeen: number;
  gold: number;
  wallet: string;
  characterTokenId: number;
}

export interface InventoryEntry {
  tokenId: number;
  templateId: number;
  name: string;
  type: string;
  quantity: number;
  equipped: boolean;
}

export interface MobInstance {
  id: string;                 // unique instance ID
  templateId: string;
  zone: string;
  position: { x: number; y: number };
  currentHp: number;
  maxHp: number;
  deadUntil: number | null;   // null = alive, timestamp = respawn time
  targetPlayerId: string | null;
  spawnPosition: { x: number; y: number };
}

export interface ZoneState {
  id: string;
  players: Map<string, Player>;
  mobs: Map<string, MobInstance>;
  lastTick: number;
}

// ============================================================
// ZONE RUNTIME
// ============================================================

export class ZoneRuntime {
  public zones: Map<string, ZoneState> = new Map();
  public players: Map<string, Player> = new Map();   // global player registry
  public questManager: QuestManager = new QuestManager();
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private mobCounter = 0;

  constructor() {
    this.initZones();
  }

  // ── Initialization ─────────────────────────────────────

  private initZones(): void {
    for (const [zoneId, zoneDef] of Object.entries(ZONES)) {
      const state: ZoneState = {
        id: zoneId,
        players: new Map(),
        mobs: new Map(),
        lastTick: Date.now(),
      };

      // Spawn mobs from zone definition
      for (const spawn of zoneDef.mobSpawns) {
        const template = MOB_TEMPLATES[spawn.templateId];
        if (!template) continue;

        for (let i = 0; i < spawn.count; i++) {
          const offset = { x: randInt(-20, 20), y: randInt(-20, 20) };
          const mob = this.createMobInstance(
            spawn.templateId,
            zoneId,
            {
              x: spawn.position.x + offset.x,
              y: spawn.position.y + offset.y,
            }
          );
          state.mobs.set(mob.id, mob);
        }
      }

      this.zones.set(zoneId, state);
      console.log(`  ✅ Zone "${zoneDef.name}" initialized (${state.mobs.size} mobs)`);
    }
  }

  private createMobInstance(templateId: string, zone: string, position: { x: number; y: number }): MobInstance {
    const template = MOB_TEMPLATES[templateId];
    const id = `mob_${++this.mobCounter}`;
    return {
      id,
      templateId,
      zone,
      position: { ...position },
      currentHp: template.hp,
      maxHp: template.hp,
      deadUntil: null,
      targetPlayerId: null,
      spawnPosition: { ...position },
    };
  }

  // ── Game Loop ─────────────────────────────────────────

  startTickLoop(intervalMs = 1000, onTick?: (snapshot: any) => void): void {
    this.tickInterval = setInterval(() => {
      this.tick();
      if (onTick) onTick(this.getFullWorldSnapshot());
    }, intervalMs);
    console.log(`🔄 Game loop started (${intervalMs}ms tick)`);
  }

  stopTickLoop(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  private tick(): void {
    const now = Date.now();

    for (const [zoneId, zone] of this.zones.entries()) {
      // Respawn dead mobs
      for (const [mobId, mob] of zone.mobs.entries()) {
        if (mob.deadUntil && now >= mob.deadUntil) {
          mob.currentHp = mob.maxHp;
          mob.deadUntil = null;
          mob.position = { ...mob.spawnPosition };
          mob.targetPlayerId = null;
        }
      }

      // Respawn dead players
      for (const [playerId, player] of zone.players.entries()) {
        if (player.currentHp <= 0 && player.respawnAt) {
          if (checkRespawn(player)) {
            console.log(`💫 ${player.name} respawned in ${zoneId}`);
          }
        }
      }

      // Passive HP regen — 1% of maxHp per tick for alive players out of combat
      for (const [, player] of zone.players.entries()) {
        if (player.currentHp > 0 && player.currentHp < player.maxHp) {
          const regen = Math.max(1, Math.floor(player.maxHp * 0.01));
          player.currentHp = Math.min(player.maxHp, player.currentHp + regen);
        }
      }

      // Aggressive mob targeting
      for (const [mobId, mob] of zone.mobs.entries()) {
        if (mob.deadUntil) continue;
        const template = MOB_TEMPLATES[mob.templateId];
        if (!template.aggressive) continue;

        // Find nearest player
        let nearest: Player | null = null;
        let nearestDist = 80; // aggro range

        for (const [, player] of zone.players.entries()) {
          if (player.currentHp <= 0) continue;
          const dist = distance(mob.position, player.position);
          if (dist < nearestDist) {
            nearestDist = dist;
            nearest = player;
          }
        }

        mob.targetPlayerId = nearest?.id || null;
      }

      zone.lastTick = now;
    }
  }

  // ── Player Management ─────────────────────────────────

  spawnPlayer(params: {
    id: string;
    name: string;
    class: string;
    race: string;
    zone: string;
    wallet: string;
    characterTokenId: number;
  }): Player {
    const zoneDef = ZONES[params.zone];
    const spawnPoint = zoneDef.spawnPoints[Math.floor(Math.random() * zoneDef.spawnPoints.length)];
    const maxHp = calculateMaxHp(1, params.class);

    const player: Player = {
      id: params.id,
      name: params.name,
      class: params.class,
      race: params.race,
      level: 1,
      xp: 0,
      currentHp: maxHp,
      maxHp,
      zone: params.zone,
      position: { ...spawnPoint },
      zone_spawn: { ...spawnPoint },
      equippedAttackBonus: 0,
      equippedDefenseBonus: 0,
      inventory: [],
      respawnAt: null,
      lastSeen: Date.now(),
      gold: 0,
      wallet: params.wallet,
      characterTokenId: params.characterTokenId,
    };

    this.players.set(player.id, player);
    this.zones.get(params.zone)?.players.set(player.id, player);

    return player;
  }

  movePlayerToZone(playerId: string, targetZoneId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;

    const targetZone = ZONES[targetZoneId];
    if (!targetZone) return false;
    if (player.level < (targetZone.levelRange[0] - 2)) return false; // soft level gate

    // Remove from old zone
    this.zones.get(player.zone)?.players.delete(playerId);

    // Add to new zone
    const spawnPoint = targetZone.spawnPoints[0];
    player.zone = targetZoneId;
    player.position = { ...spawnPoint };
    player.zone_spawn = { ...spawnPoint };

    this.zones.get(targetZoneId)?.players.set(playerId, player);
    return true;
  }

  // ── Commands ──────────────────────────────────────────

  handleAttack(playerId: string, targetMobId: string): any {
    const player = this.players.get(playerId);
    if (!player) return { error: "Player not found" };
    if (player.currentHp <= 0) return { error: "Player is dead" };

    const zone = this.zones.get(player.zone);
    if (!zone) return { error: "Zone not found" };

    const mob = zone.mobs.get(targetMobId);
    if (!mob || mob.deadUntil) return { error: "Mob not available" };

    // Auto-move to mob then attack — always close the gap
    const dist = distance(player.position, mob.position);
    if (dist > 30) {
      moveToward(player.position, mob.position, Math.min(dist - 10, 80));
    }

    const result = resolveCombat(player, mob);

    // Update player XP and level
    if (result.xpGained > 0) {
      player.xp += result.xpGained;
      const newLevel = getLevel(player.xp);
      if (newLevel > player.level) {
        player.level = newLevel;
        player.maxHp = calculateMaxHp(newLevel, player.class);
        player.currentHp = player.maxHp; // full heal on level up
        console.log(`🎉 ${player.name} leveled up to ${newLevel}!`);
      }
    }

    // Record kills for quest progress
    if (result.mobDied) {
      player.gold += result.goldDropped;
      const readyQuests = this.questManager.recordKill(playerId, mob.templateId);
      // Auto-add loot to inventory
      for (const drop of result.loot) {
        this.addToInventory(player, drop.itemTemplateId, drop.quantity);
        // Record collect for quests
        this.questManager.recordCollect(playerId, drop.itemTemplateId, drop.quantity);
      }
    }

    return result;
  }

  handleMove(playerId: string, targetId: string): any {
    const player = this.players.get(playerId);
    if (!player) return { error: "Player not found" };

    const zone = this.zones.get(player.zone);
    if (!zone) return { error: "Zone not found" };

    // Could be moving toward mob, NPC, or portal
    const mob = zone.mobs.get(targetId);
    if (mob) {
      moveToward(player.position, mob.position, 40);
      return { success: true, position: player.position };
    }

    const npc = NPCS[targetId];
    if (npc && npc.zone === player.zone) {
      moveToward(player.position, npc.position, 30);
      return { success: true, position: player.position };
    }

    // Check portal
    const zoneDef = ZONES[player.zone];
    const portal = zoneDef.portals.find(p => p.targetZone === targetId);
    if (portal) {
      moveToward(player.position, portal.position, 20);
      // If close enough, transition
      if (distance(player.position, portal.position) < 25) {
        this.movePlayerToZone(playerId, portal.targetZone);
        return { success: true, zoneTransition: portal.targetZone };
      }
      return { success: true, position: player.position };
    }

    return { error: "Target not found" };
  }

  handleUseItem(playerId: string, tokenId: number): any {
    const player = this.players.get(playerId);
    if (!player) return { error: "Player not found" };

    const item = player.inventory.find(i => i.tokenId === tokenId);
    if (!item) return { error: "Item not in inventory" };

    const template = ITEM_TEMPLATES[item.templateId];
    if (!template) return { error: "Item template not found" };

    if (template.type === "potion") {
      const restored = Math.min(template.hpRestore, player.maxHp - player.currentHp);
      player.currentHp += restored;
      item.quantity--;
      if (item.quantity <= 0) {
        player.inventory = player.inventory.filter(i => i.tokenId !== tokenId);
      }
      return { success: true, hpRestored: restored, currentHp: player.currentHp };
    }

    return { error: "Item not usable" };
  }

  // ── State Queries ─────────────────────────────────────

  getPlayerState(playerId: string): any {
    const player = this.players.get(playerId);
    if (!player) return null;

    const zone = this.zones.get(player.zone);
    const zoneDef = ZONES[player.zone];

    // Nearby entities (within 150 units)
    const nearbyEntities: any[] = [];

    // Nearby mobs
    for (const [, mob] of (zone?.mobs?.entries() || [])) {
      if (mob.deadUntil) continue;
      const dist = distance(player.position, mob.position);
      if (dist <= 150) {
        const template = MOB_TEMPLATES[mob.templateId];
        nearbyEntities.push({
          id: mob.id,
          type: "mob",
          name: template.name,
          level: template.level,
          health: mob.currentHp,
          maxHealth: mob.maxHp,
          distance: Math.floor(dist),
          aggressive: template.aggressive,
        });
      }
    }

    // Nearby NPCs
    for (const npcId of (zoneDef?.npcs || [])) {
      const npc = NPCS[npcId];
      if (!npc) continue;
      const dist = distance(player.position, npc.position);
      nearbyEntities.push({
        id: npc.id,
        type: "npc",
        name: npc.name,
        role: npc.role,
        distance: Math.floor(dist),
      });
    }

    // Portals
    for (const portal of (zoneDef?.portals || [])) {
      const dist = distance(player.position, portal.position);
      nearbyEntities.push({
        id: portal.targetZone,
        type: "portal",
        name: `Portal to ${ZONES[portal.targetZone]?.name || portal.targetZone}`,
        distance: Math.floor(dist),
        requiredLevel: portal.requiredLevel,
      });
    }

    // Sort by distance
    nearbyEntities.sort((a, b) => a.distance - b.distance);

    const activeQuests = this.questManager.getActiveQuests(playerId).map(q => ({
      id: q.id,
      name: q.name,
      description: q.description,
      progress: q.progress.currentCount,
      goal: (q.objective as any).count,
      goldReward: q.goldReward,
      xpReward: q.xpReward,
      completed: q.progress.currentCount >= (q.objective as any).count,
    }));

    return {
      playerId,
      zone: player.zone,
      position: player.position,
      health: player.currentHp,
      maxHealth: player.maxHp,
      level: player.level,
      xp: player.xp,
      gold: player.gold,
      inventory: player.inventory,
      activeQuests,
      availableQuests: (zoneDef?.npcs || []).flatMap(npcId => {
        const npc = NPCS[npcId];
        if (!npc) return [];
        return this.questManager.getAvailableQuests(player, player.zone, npcId)
          .map(q => ({ id: q.id, name: q.name, npcId, npcName: npc.name, goldReward: q.goldReward, xpReward: q.xpReward }));
      }),
      nearbyEntities,
      characterTokenId: player.characterTokenId,
    };
  }

  getBatchState(playerIds: string[]): Record<string, any> {
    const result: Record<string, any> = {};
    for (const id of playerIds) {
      const state = this.getPlayerState(id);
      if (state) result[id] = state;
    }
    return result;
  }

  getFullWorldSnapshot(): any {
    const zones: any = {};
    for (const [zoneId, zone] of this.zones.entries()) {
      zones[zoneId] = {
        id: zoneId,
        name: ZONES[zoneId]?.name || zoneId,
        playerCount: zone.players.size,
        aliveMobs: [...zone.mobs.values()].filter(m => !m.deadUntil).length,
        totalMobs: zone.mobs.size,
        mobs: [...zone.mobs.values()]
          .filter(m => !m.deadUntil)
          .map(m => ({
            id: m.id,
            templateId: m.templateId,
            name: MOB_TEMPLATES[m.templateId]?.name || m.templateId,
            position: m.position,
            hp: m.currentHp,
            maxHp: m.maxHp,
          })),
      };
    }

    const agents = [...this.players.values()].map(p => ({
      id: p.id, name: p.name, class: p.class,
      level: p.level, xp: p.xp,
      hp: p.currentHp, maxHp: p.maxHp,
      zone: p.zone, gold: p.gold,
      x: Math.round(p.position.x),
      y: Math.round(p.position.y),
      questsCompleted: this.questManager.getCompletedCount(p.id),
      lastAction: "",
    }));

    return { zones, agents, totalPlayers: this.players.size };
  }

  // ── Inventory ─────────────────────────────────────────

  addToInventory(player: Player, templateId: number, quantity: number): void {
    const template = ITEM_TEMPLATES[templateId];
    if (!template) return;

    const existing = player.inventory.find(i => i.templateId === templateId && i.type === "potion");
    if (existing) {
      existing.quantity += quantity;
    } else {
      player.inventory.push({
        tokenId: Date.now() + Math.random(),  // temp token ID (real one set on-chain)
        templateId,
        name: template.name,
        type: template.type,
        quantity,
        equipped: false,
      });
    }
  }
}

// ============================================================
// HELPERS
// ============================================================

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
}

function moveToward(
  from: { x: number; y: number },
  to: { x: number; y: number },
  speed: number
): void {
  const dist = distance(from, to);
  if (dist <= speed) {
    from.x = to.x;
    from.y = to.y;
  } else {
    const ratio = speed / dist;
    from.x += (to.x - from.x) * ratio;
    from.y += (to.y - from.y) * ratio;
  }
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
