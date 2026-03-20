/**
 * aibtcSprint.ts — Sprint competition integration
 *
 * Submits agent leaderboard scores to the wog-sprint contract on Stacks.
 * Top performer at sprint end wins real STX from the prize pool.
 *
 * Called from batchAgents.ts every SPRINT_SUBMIT_INTERVAL ticks.
 */

import {
  stringAsciiCV,
  uintCV,
  callReadOnlyFunction,
  cvToJSON,
} from "@stacks/transactions";
import { StacksTestnet, StacksMainnet } from "@stacks/network";
import { enqueueContractCall } from "./txQueue";
import type { AgentState } from "./batchAgents";

// ============================================================
// CONFIG
// ============================================================

const USE_MAINNET = process.env.STACKS_NETWORK === "mainnet";
const NETWORK = USE_MAINNET ? new StacksMainnet() : new StacksTestnet();

const SERVER_ADDRESS = process.env.SERVER_STACKS_ADDRESS!;

// The wog-sprint contract — deployed from same deployer address
const SPRINT_CONTRACT_ADDRESS = process.env.SPRINT_CONTRACT_ADDRESS || SERVER_ADDRESS;
const SPRINT_CONTRACT_NAME = "wog-sprint";

// Submit scores every N ticks (default: every 20 ticks = ~60s at 3s ticks)
export const SPRINT_SUBMIT_INTERVAL = parseInt(process.env.SPRINT_SUBMIT_INTERVAL || "20");

// ============================================================
// HELPERS
// ============================================================

async function callContract(
  functionName: string,
  functionArgs: any[],
): Promise<string> {
  return enqueueContractCall(SPRINT_CONTRACT_ADDRESS, SPRINT_CONTRACT_NAME, functionName, functionArgs);
}

async function readContract(functionName: string, functionArgs: any[]): Promise<any> {
  const result = await callReadOnlyFunction({
    contractAddress: SPRINT_CONTRACT_ADDRESS,
    contractName: SPRINT_CONTRACT_NAME,
    functionName,
    functionArgs,
    network: NETWORK,
    senderAddress: SERVER_ADDRESS,
  });
  return cvToJSON(result);
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Create a new sprint competition.
 * @param name       Sprint name (e.g. "Week 1 — Gold Rush")
 * @param durationBlocks  How many blocks the sprint lasts (~10min/block on testnet)
 * @param prizeStx   Prize pool in micro-STX (1 STX = 1_000_000)
 */
export async function createSprint(
  name: string,
  durationBlocks: number,
  prizeStx: number,
): Promise<string> {
  console.log(`🏁 Creating sprint "${name}" — ${durationBlocks} blocks, ${prizeStx / 1_000_000} STX prize`);
  return callContract("create-sprint", [
    stringAsciiCV(name.slice(0, 64)),
    uintCV(durationBlocks),
    uintCV(prizeStx),
  ]);
}

/**
 * Register agents for the current sprint. Call once after createSprint.
 */
export async function registerAgents(agents: AgentState[]): Promise<void> {
  for (const agent of agents) {
    if (agent.characterTokenId === 0) {
      console.warn(`⚠️  Skipping ${agent.name} — no characterTokenId`);
      continue;
    }
    try {
      await callContract("register-agent", [
        uintCV(agent.characterTokenId),
        stringAsciiCV(agent.name.slice(0, 32)),
      ]);
      console.log(`  ✅ Registered ${agent.name} (token #${agent.characterTokenId}) for sprint`);
    } catch (e: any) {
      console.warn(`  ⚠️  Failed to register ${agent.name}: ${e.message}`);
    }
  }
}

/**
 * Submit current scores for all agents. Called periodically from the game loop.
 */
export async function submitScores(agents: AgentState[]): Promise<void> {
  for (const agent of agents) {
    if (agent.characterTokenId === 0) continue;

    try {
      await callContract("submit-score", [
        uintCV(agent.characterTokenId),
        uintCV(agent.questsCompleted.length),
        uintCV(0), // mobs-killed — add tracking if needed
        uintCV(agent.gold),
        uintCV(agent.xp),
      ]);
    } catch (e: any) {
      // Don't spam logs — scores submit in background
      console.warn(`Sprint score submit failed for ${agent.name}: ${e.message}`);
    }
  }
  console.log(`🏁 Sprint scores submitted for ${agents.filter(a => a.characterTokenId > 0).length} agents`);
}

/**
 * Get the current sprint info.
 */
export async function getCurrentSprint(): Promise<any> {
  const result = await readContract("get-current-sprint", []);
  return result?.value || null;
}

/**
 * Get an agent's score in a sprint.
 */
export async function getAgentScore(sprintId: number, characterId: number): Promise<any> {
  const result = await readContract("get-agent-score", [uintCV(sprintId), uintCV(characterId)]);
  return result?.value || null;
}

/**
 * Finalize the sprint — determine winner and distribute prize.
 * Call after sprint end-block has passed.
 */
export async function finalizeSprint(agents: AgentState[]): Promise<string | null> {
  // Find the agent with highest composite score locally
  let bestAgent: AgentState | null = null;
  let bestScore = 0;

  for (const agent of agents) {
    const score =
      agent.questsCompleted.length * 100 +
      agent.gold +
      agent.xp;

    if (score > bestScore) {
      bestScore = score;
      bestAgent = agent;
    }
  }

  if (!bestAgent || bestAgent.characterTokenId === 0) {
    console.warn("🏁 No valid winner found");
    return null;
  }

  console.log(`🏆 Sprint winner: ${bestAgent.name} (score: ${bestScore})`);

  try {
    const txid = await callContract("finalize-sprint", [
      uintCV(bestAgent.characterTokenId),
    ]);
    console.log(`🏆 Sprint finalized! Winner: ${bestAgent.name} — txid: ${txid}`);
    return txid;
  } catch (e: any) {
    console.warn(`Sprint finalize failed: ${e.message}`);
    return null;
  }
}

/**
 * Print sprint standings to console.
 */
export function printStandings(agents: AgentState[]): void {
  const standings = agents
    .map(a => ({
      name: a.name,
      score: a.questsCompleted.length * 100 + a.gold + a.xp,
      quests: a.questsCompleted.length,
      gold: a.gold,
      xp: a.xp,
    }))
    .sort((a, b) => b.score - a.score);

  console.log("\n🏁 ── Sprint Standings ──");
  standings.forEach((s, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "  ";
    console.log(`  ${medal} ${s.name.padEnd(8)} Score:${String(s.score).padStart(6)} | Q:${s.quests} G:${s.gold} XP:${s.xp}`);
  });
  console.log();
}
