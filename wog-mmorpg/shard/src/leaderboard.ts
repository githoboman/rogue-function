/**
 * leaderboard.ts — On-chain leaderboard integration
 * Writes agent achievements to leaderboard.clar after milestones
 */

import { stringAsciiCV, uintCV } from "@stacks/transactions";
import { enqueueContractCall } from "./txQueue";
import type { AgentState } from "./batchAgents";

const LEADERBOARD_ADDRESS  = process.env.SERVER_STACKS_ADDRESS!;
const LEADERBOARD_CONTRACT = "leaderboard";

// Throttle: only write to chain if level or quests have changed since last write
const lastWritten = new Map<string, { level: number; quests: number }>();

export async function updateLeaderboard(agent: AgentState): Promise<void> {
  if (!process.env.SERVER_PRIVATE_KEY || agent.characterTokenId === 0) return;

  const prev = lastWritten.get(agent.id);
  const questsDone = agent.questsCompleted.length;

  // Skip if nothing meaningful changed
  if (prev && prev.level === agent.level && prev.quests === questsDone) return;

  lastWritten.set(agent.id, { level: agent.level, quests: questsDone });

  try {
    const txid = await enqueueContractCall(
      LEADERBOARD_ADDRESS,
      LEADERBOARD_CONTRACT,
      "update-entry",
      [
        uintCV(agent.characterTokenId),
        stringAsciiCV(agent.name.slice(0, 32)),
        stringAsciiCV(agent.class.slice(0, 16)),
        uintCV(agent.level),
        uintCV(agent.xp),
        uintCV(questsDone),
        uintCV(agent.gold),
        uintCV(0),
      ],
    );
    console.log(`📊 Leaderboard updated: ${agent.name} Lv${agent.level} — txid: ${txid}`);
  } catch (e: any) {
    console.warn(`Leaderboard update failed for ${agent.name}: ${e.message}`);
  }
}
