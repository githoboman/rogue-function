/**
 * deployProperty.ts — Deploy wog-property SIP-009 contract to Stacks testnet
 * Run: node --env-file=.env node_modules/tsx/dist/cli.mjs src/deployProperty.ts
 */

import {
  makeContractDeploy,
  broadcastTransaction,
  AnchorMode,
  PostConditionMode,
} from "@stacks/transactions";
import { StacksTestnet } from "@stacks/network";
import * as fs from "fs";
import * as path from "path";

const PRIVATE_KEY  = process.env.SERVER_PRIVATE_KEY!;
const ADDRESS      = process.env.SERVER_STACKS_ADDRESS!;
const CONTRACT_NAME = "wog-property";

async function deploy() {
  console.log(`Deploying ${CONTRACT_NAME} from ${ADDRESS}...`);

  // Read contract — strip impl-trait (mainnet address fails on testnet)
  const contractPath = path.join(__dirname, "../../contracts/wog-property.clar");
  let code = fs.readFileSync(contractPath, "utf-8");
  code = code.replace(/\(impl-trait[^\)]+\)\s*/g, "");
  console.log(`Contract: ${code.length} chars`);

  const network = new StacksTestnet();

  const tx = await makeContractDeploy({
    contractName:    CONTRACT_NAME,
    codeBody:        code,
    senderKey:       PRIVATE_KEY,
    network,
    anchorMode:      AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
    fee:             50000n,  // 0.05 STX
  });

  console.log("Broadcasting...");
  let result: any;
  try {
    result = await broadcastTransaction(tx, network);
  } catch(e: any) {
    // Raw error — fetch manually to see full response
    const raw = tx.serialize();
    const resp = await fetch("https://api.testnet.hiro.so/v2/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: raw,
    });
    const text = await resp.text();
    console.error("Raw broadcast response:", text);
    process.exit(1);
  }

  if (result && "error" in result) {
    console.error("Deploy failed:", result.error, result.reason);
    process.exit(1);
  }

  const txId = result.txid;
  console.log(`\n✅ Contract deployed!`);
  console.log(`   txid: ${txId}`);
  console.log(`   Contract: ${ADDRESS}.${CONTRACT_NAME}`);
  console.log(`   Explorer: https://explorer.hiro.so/txid/0x${txId}?chain=testnet`);
  console.log(`\nAdd to .env:`);
  console.log(`   PROPERTY_CONTRACT_ADDRESS=${ADDRESS}`);
}

deploy().catch(e => { console.error(e.message); process.exit(1); });
