/**
 * spawnCharacterNFT.ts — Mint Character NFTs for Agents
 * Run once before starting agents for the first time.
 * Saves token IDs to shard/agent-characters.json
 *
 * Usage: pnpm exec tsx src/spawnCharacterNFT.ts
 */

import { mintCharacter, getCharactersByWallet } from "./blockchain";
import * as fs from "fs";
import * as path from "path";

const AGENTS = [
  { name: "Ragnar", classId: 0, race: 0 }, // Warrior / Human
  { name: "Lyria",  classId: 1, race: 1 }, // Mage / Elf
  { name: "Kira",   classId: 2, race: 1 }, // Ranger / Elf
  { name: "Thorn",  classId: 4, race: 3 }, // Rogue / Orc
  { name: "Elara",  classId: 3, race: 0 }, // Cleric / Human
];

const CONFIG_PATH = path.join(__dirname, "../agent-characters.json");
const SERVER_ADDRESS = process.env.SERVER_STACKS_ADDRESS!;

async function main() {
  if (!SERVER_ADDRESS) throw new Error("SERVER_STACKS_ADDRESS not set in .env");

  const count  = parseInt(process.env.AGENT_COUNT || "3");
  const agents = AGENTS.slice(0, count);

  console.log(`\n🧙 Minting ${agents.length} character NFTs...\n`);

  let config: Record<string, any> = {};
  if (fs.existsSync(CONFIG_PATH)) {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    console.log("📋 Found existing config — skipping already minted\n");
  }

  for (let i = 0; i < agents.length; i++) {
    const agent  = agents[i];
    const agentId = `agent-${i}`;

    if (config[agentId]?.characterTokenId) {
      console.log(`  ⏭️  ${agent.name} already minted (id: ${config[agentId].characterTokenId})`);
      continue;
    }

    console.log(`  🪙 Minting ${agent.name}...`);
    const txId = await mintCharacter(SERVER_ADDRESS, agent.name, agent.race, agent.classId);
    console.log(`     TX: ${txId} — waiting 30s for confirmation...`);
    await sleep(30000);

    const tokenIds = await getCharactersByWallet(SERVER_ADDRESS);
    const tokenId  = tokenIds[tokenIds.length - 1];

    config[agentId] = { name: agent.name, classId: agent.classId, race: agent.race, characterTokenId: tokenId, wallet: SERVER_ADDRESS };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(`     ✅ Token ID: ${tokenId}\n`);

    await sleep(3000);
  }

  console.log("✅ Done! agent-characters.json saved.");
  console.log("Now run: pnpm exec tsx src/batchAgents.ts\n");
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
main().catch(e => { console.error(e.message); process.exit(1); });
