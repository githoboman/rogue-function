/**
 * config.ts — Centralized game configuration
 * All magic numbers in one place for easy tuning.
 */

export const GameConfig = {
  // ── Server ──────────────────────────────────────────────
  PORT: parseInt(process.env.PORT || "3000"),
  TICK_INTERVAL_MS: 1000,           // Game world tick rate

  // ── Rate Limiting ───────────────────────────────────────
  RATE_LIMIT_MAX: 100,              // Max requests per window per IP
  RATE_LIMIT_WINDOW_MS: 10_000,     // 10 second window

  // ── Combat ──────────────────────────────────────────────
  BASE_CRIT_CHANCE: 0.05,           // 5% base crit
  CRIT_MULTIPLIER: 1.75,
  LEVEL_DAMAGE_SCALE: 0.08,         // 8% more damage per level above mob
  RESPAWN_TIMER_MS: 5000,           // 5 second death timer
  RESPAWN_HP_PERCENT: 0.5,          // Respawn at 50% HP
  MOB_AGGRO_RANGE: 80,              // Distance for mob targeting

  // ── Agents ──────────────────────────────────────────────
  AGENT_TICK_MS: 3000,              // AI agent decision interval
  AGENT_MAX_ACTIONS_PER_TICK: 3,    // External agent rate limit
  AGENT_TICK_WINDOW_MS: 3000,       // Window for action rate limiting

  // ── Blockchain ──────────────────────────────────────────
  TX_DELAY_MS: 500,                 // Delay between queued TXs
  TX_MAX_RETRIES: 3,                // Max nonce conflict retries
  GOLD_DECIMALS: 1_000_000,         // 6 decimals (micro-GOLD)

  // ── Sprint ──────────────────────────────────────────────
  SPRINT_SUBMIT_INTERVAL: parseInt(process.env.SPRINT_SUBMIT_INTERVAL || "20"),

  // ── Persistence ─────────────────────────────────────────
  SAVE_INTERVAL_MS: 30_000,         // Auto-save every 30 seconds
  SAVE_FILE: process.env.SAVE_FILE || "game-state.json",

  // ── Client ──────────────────────────────────────────────
  STREAK_TIMEOUT_MS: 15_000,        // Kill streak window
  PLAYER_AI_TICK_MS: 3500,          // Human player AI loop interval
} as const;
