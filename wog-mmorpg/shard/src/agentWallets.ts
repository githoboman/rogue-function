/**
 * agentWallets.ts — HD Wallet Manager for AI Agents
 *
 * One seed phrase → deterministic wallets for every agent.
 * Agent 0 always gets the same address, Agent 1 always gets the same, etc.
 * You only need to store ONE seed in .env — never individual private keys.
 *
 * Stacks derivation path: m/44'/5757'/0'/0/{agentIndex}
 */

import {
  generateSecretKey,
  generateWallet,
  getStxAddress,
} from "@stacks/wallet-sdk";
import { TransactionVersion } from "@stacks/transactions";
import { StacksTestnet, StacksMainnet } from "@stacks/network";
import * as fs from "fs";

// ============================================================
// CONFIG
// ============================================================

const USE_MAINNET = process.env.STACKS_NETWORK === "mainnet";
const TX_VERSION = USE_MAINNET
  ? TransactionVersion.Mainnet
  : TransactionVersion.Testnet;

// Max agents supported (we support up to 20, use 2-5)
const MAX_AGENTS = 20;

// ============================================================
// TYPES
// ============================================================

export interface AgentWallet {
  agentIndex: number;
  agentId: string;        // "agent-0", "agent-1", etc.
  address: string;        // ST1ABC... (testnet) or SP1ABC... (mainnet)
  privateKey: string;     // Used to sign transactions
}

// ============================================================
// WALLET DERIVATION
// ============================================================

/**
 * Derive agent wallets from a single seed phrase.
 * Call this once at startup — wallets are deterministic.
 *
 * @param seedPhrase  12 or 24 word mnemonic from AGENT_SEED_PHRASE in .env
 * @param count       Number of agent wallets to derive (2-5)
 */
export async function deriveAgentWallets(
  seedPhrase: string,
  count: number
): Promise<AgentWallet[]> {
  if (count > MAX_AGENTS) throw new Error(`Max ${MAX_AGENTS} agents supported`);

  // Generate full HD wallet from seed
  const wallet = await generateWallet({
    secretKey: seedPhrase,
    password: "", // no extra password
  });

  const agents: AgentWallet[] = [];

  for (let i = 0; i < count; i++) {
    // Each account in the HD wallet = one agent
    // generateWallet gives us wallet.accounts — but only generates up to the index we need
    const walletWithAccounts = await generateWallet({
      secretKey: seedPhrase,
      password: "",
    });

    // Manually derive account at index i using the stacks wallet SDK
    const { accounts } = await generateWallet({
      secretKey: seedPhrase,
      password: "",
    });

    // Add more accounts if needed
    let currentWallet = walletWithAccounts;
    while (currentWallet.accounts.length <= i) {
      const { generateNewAccount } = await import("@stacks/wallet-sdk");
      currentWallet = generateNewAccount(currentWallet);
    }

    const account = currentWallet.accounts[i];
    const address = getStxAddress({
      account,
      transactionVersion: TX_VERSION,
    });

    agents.push({
      agentIndex: i,
      agentId: `agent-${i}`,
      address,
      privateKey: account.stxPrivateKey,
    });

    console.log(`🔑 Agent ${i} wallet derived: ${address}`);
  }

  return agents;
}

/**
 * Generate a brand new seed phrase.
 * Run ONCE, save the output to AGENT_SEED_PHRASE in .env, never run again.
 */
export function generateNewSeedPhrase(): string {
  const secretKey = generateSecretKey();
  return secretKey;
}

// ============================================================
// FAUCET HELPER (Testnet only)
// ============================================================

/**
 * Request testnet STX for an agent wallet (needed for gas fees).
 * Each wallet needs a small amount of STX to pay transaction fees.
 */
export async function requestTestnetSTX(address: string): Promise<void> {
  if (USE_MAINNET) {
    console.warn("⚠️ Faucet only works on testnet");
    return;
  }

  try {
    const response = await fetch(
      `https://api.testnet.hiro.so/extended/v1/faucets/stx?address=${address}&stacking=false`,
      { method: "POST" }
    );
    const data = await response.json();
    if (data.success) {
      console.log(`💧 Testnet STX sent to ${address} — txid: ${data.txId}`);
    } else {
      console.warn(`⚠️ Faucet failed for ${address}: ${JSON.stringify(data)}`);
    }
  } catch (e) {
    console.warn(`⚠️ Faucet request failed: ${e}`);
  }
}

// ============================================================
// SETUP SCRIPT — run this once to bootstrap agents
// ============================================================

export async function setupAgentWallets(): Promise<void> {
  const seedPhrase = process.env.AGENT_SEED_PHRASE;
  const agentCount = parseInt(process.env.AGENT_COUNT || "3");

  if (!seedPhrase) {
    // First time setup — generate seed phrase
    console.log("\n🆕 No AGENT_SEED_PHRASE found. Generating new seed phrase...\n");
    const newSeed = generateNewSeedPhrase();
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("⚠️  SAVE THIS SEED PHRASE — you can never recover it!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`\nAGENT_SEED_PHRASE="${newSeed}"\n`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\nAdd this to your shard/.env, then run this script again.\n");
    process.exit(0);
  }

  console.log(`\n🤖 Setting up ${agentCount} agent wallets...\n`);
  const wallets = await deriveAgentWallets(seedPhrase, agentCount);

  console.log("\n📋 Agent Wallet Addresses:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  wallets.forEach(w => {
    console.log(`  ${w.agentId}: ${w.address}`);
  });
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Request testnet STX for each agent
  if (!USE_MAINNET) {
    console.log("💧 Requesting testnet STX for gas fees...");
    for (const wallet of wallets) {
      await requestTestnetSTX(wallet.address);
      await new Promise(r => setTimeout(r, 1000)); // rate limit
    }
  }

  console.log("\n✅ Wallet setup complete! You can now run the agent manager.\n");
}

// Run directly: pnpm exec tsx src/agentWallets.ts
if (require.main === module) {
  setupAgentWallets().catch(console.error);
}
