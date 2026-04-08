/**
 * mintProperties.ts -- Mint all WoG property deeds on-chain (SIP-009 NFTs)
 * Run: node --env-file=.env node_modules/tsx/dist/cli.mjs src/mintProperties.ts
 *
 * Mints each property from PROPERTIES[] to the server wallet (realm owner).
 * Agents buy from the realm via the in-game shop or FoxMQ P2P market.
 */

import {
  makeContractCall,
  broadcastTransaction,
  AnchorMode,
  PostConditionMode,
  stringAsciiCV,
  uintCV,
  principalCV,
} from "@stacks/transactions";
import { StacksTestnet } from "@stacks/network";
import * as fs from "fs";
import * as path from "path";

const PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY!;
const ADDRESS     = process.env.SERVER_STACKS_ADDRESS!;
const CONTRACT    = "wog-property";
const network     = new StacksTestnet();

async function fetchNonce(address: string): Promise<number> {
  const url = `https://api.testnet.hiro.so/v2/accounts/${address}?proof=0`;
  const res = await fetch(url);
  const data: any = await res.json();
  return data.nonce as number;
}

const PROPERTIES = [
  // Human Meadow
  { id: "meadow_cottage_1",  name: "Farmer's Cottage",       zone: "human_meadow", tier: 1, rentPerTick: 3,   maxTenants: 1 },
  { id: "meadow_cottage_2",  name: "Riverside Cabin",         zone: "human_meadow", tier: 1, rentPerTick: 4,   maxTenants: 1 },
  { id: "meadow_house_1",    name: "Miller's House",          zone: "human_meadow", tier: 2, rentPerTick: 9,   maxTenants: 2 },
  { id: "meadow_manor_1",    name: "Aldric's Manor",          zone: "human_meadow", tier: 3, rentPerTick: 22,  maxTenants: 3 },
  // Wild Meadow
  { id: "wild_cottage_1",    name: "Ranger's Outpost",        zone: "wild_meadow",  tier: 1, rentPerTick: 6,   maxTenants: 1 },
  { id: "wild_house_1",      name: "Trapper's Lodge",         zone: "wild_meadow",  tier: 2, rentPerTick: 13,  maxTenants: 2 },
  { id: "wild_house_2",      name: "Merchant Waystation",     zone: "wild_meadow",  tier: 2, rentPerTick: 15,  maxTenants: 2 },
  { id: "wild_manor_1",      name: "Elias Hunting Lodge",     zone: "wild_meadow",  tier: 3, rentPerTick: 34,  maxTenants: 3 },
  // Dark Forest
  { id: "dark_house_1",      name: "Shadow Warden Keep",      zone: "dark_forest",  tier: 2, rentPerTick: 22,  maxTenants: 2 },
  { id: "dark_manor_1",      name: "Necromancer Tower",       zone: "dark_forest",  tier: 3, rentPerTick: 58,  maxTenants: 3 },
  { id: "dark_castle_1",     name: "Shadowgate Castle",       zone: "dark_forest",  tier: 4, rentPerTick: 120, maxTenants: 5 },
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function mintOne(prop: typeof PROPERTIES[0], index: number, nonce: number): Promise<{ id: string; tokenId: number; txid: string }> {
  console.log(`\n[${index + 1}/${PROPERTIES.length}] Minting "${prop.name}" (${prop.zone}, tier ${prop.tier})... nonce=${nonce}`);

  const tx = await makeContractCall({
    contractAddress: ADDRESS,
    contractName:    CONTRACT,
    functionName:    "mint",
    functionArgs: [
      principalCV(ADDRESS),                    // recipient = realm wallet
      stringAsciiCV(prop.name),
      stringAsciiCV(prop.zone),
      uintCV(prop.tier),
      uintCV(prop.rentPerTick),
      uintCV(prop.maxTenants),
    ],
    senderKey:        PRIVATE_KEY,
    network,
    anchorMode:       AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
    fee:              5000n,
    nonce:            BigInt(nonce),
  });

  const result = await broadcastTransaction(tx, network);

  if ("error" in result) {
    throw new Error(`Mint failed: ${result.error} — ${result.reason}`);
  }

  const tokenId = index + 1;
  console.log(`  OK  tokenId=${tokenId}  txid=0x${result.txid}`);
  return { id: prop.id, tokenId, txid: result.txid };
}

async function run() {
  console.log("=".repeat(60));
  console.log("  WoG Property Mint -- Stacks Testnet");
  console.log(`  Deployer: ${ADDRESS}`);
  console.log(`  Contract: ${ADDRESS}.${CONTRACT}`);
  console.log("=".repeat(60));

  // Load already-minted tokens if any
  const outPath = path.join(__dirname, "../property-tokens.json");
  let minted: Record<string, { tokenId: number; txid: string }> = {};
  try {
    minted = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    console.log(`  Resuming: ${Object.keys(minted).length} already minted`);
  } catch {}

  // Fetch current on-chain nonce
  let nonce = await fetchNonce(ADDRESS);
  console.log(`  Starting nonce: ${nonce}`);

  for (let i = 0; i < PROPERTIES.length; i++) {
    const prop = PROPERTIES[i];
    if (minted[prop.id]) {
      console.log(`\n[${i + 1}/${PROPERTIES.length}] Skipping "${prop.name}" (already minted)`);
      continue;
    }
    try {
      const result = await mintOne(prop, i, nonce);
      minted[result.id] = { tokenId: result.tokenId, txid: result.txid };
      nonce++;
      // Brief pause to let mempool accept
      await sleep(500);
    } catch (e: any) {
      console.error(`  FAILED: ${e.message}`);
    }
  }

  // Save token ID mapping for propertyMarket.ts
  fs.writeFileSync(outPath, JSON.stringify(minted, null, 2));

  console.log("\n" + "=".repeat(60));
  console.log(`  Minted ${Object.keys(minted).length}/${PROPERTIES.length} properties`);
  console.log(`  Token map saved: ${outPath}`);
  console.log("\n  Contract explorer:");
  console.log(`  https://explorer.hiro.so/address/${ADDRESS}.${CONTRACT}?chain=testnet`);
  console.log("=".repeat(60));
}

run().catch(e => { console.error(e.message); process.exit(1); });
