/**
 * createSprint.ts — Create a new sprint and register agents
 *
 * Usage: npm run sprint:create
 *
 * Creates a sprint competition on-chain and registers all agents.
 * Run this once before starting the agents to enable STX earning.
 */

import { createSprint, registerAgents } from "./aibtcSprint";
import * as fs from "fs";
import * as path from "path";

const SPRINT_NAME = process.argv[2] || "WoG Sprint #1";
const DURATION_BLOCKS = parseInt(process.argv[3] || "144"); // ~24h on testnet (~10min/block)
const PRIZE_STX = parseInt(process.argv[4] || "1000000"); // 1 STX in micro-STX

async function main() {
  console.log(`\n🏁 Creating Sprint Competition\n`);
  console.log(`  Name:     ${SPRINT_NAME}`);
  console.log(`  Duration: ${DURATION_BLOCKS} blocks`);
  console.log(`  Prize:    ${PRIZE_STX / 1_000_000} STX\n`);

  // Create the sprint
  const txid = await createSprint(SPRINT_NAME, DURATION_BLOCKS, PRIZE_STX);
  console.log(`  TX: ${txid}`);
  console.log(`  Waiting 30s for confirmation...\n`);
  await sleep(30000);

  // Load agent characters
  const configPath = path.join(__dirname, "../agent-characters.json");
  if (!fs.existsSync(configPath)) {
    console.error("agent-characters.json not found. Run `npm run mint` first.");
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const count = parseInt(process.env.AGENT_COUNT || "3");

  // Build minimal agent state for registration
  const agents = [];
  for (let i = 0; i < count; i++) {
    const entry = config[`agent-${i}`];
    if (!entry) continue;
    agents.push({
      id: `agent-${i}`,
      name: entry.name,
      characterTokenId: entry.characterTokenId || 0,
    } as any);
  }

  // Register all agents
  console.log(`📋 Registering ${agents.length} agents...\n`);
  await registerAgents(agents);

  console.log(`\n✅ Sprint created! Agents will submit scores every ${process.env.SPRINT_SUBMIT_INTERVAL || 20} ticks.`);
  console.log(`Now run: npm run agents\n`);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
main().catch(e => { console.error(e.message); process.exit(1); });
