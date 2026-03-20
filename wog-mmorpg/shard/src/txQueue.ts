/**
 * txQueue.ts — Serialized transaction broadcaster
 *
 * All Stacks transactions from the server key MUST go through this queue
 * to avoid nonce conflicts. Adds a small delay between TXs to let the
 * mempool settle.
 */

import {
  makeContractCall,
  broadcastTransaction,
  AnchorMode,
  PostConditionMode,
  getNonce,
} from "@stacks/transactions";
import { StacksTestnet, StacksMainnet } from "@stacks/network";

const USE_MAINNET = process.env.STACKS_NETWORK === "mainnet";
const NETWORK = USE_MAINNET ? new StacksMainnet() : new StacksTestnet();
const SERVER_PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY!;
const SERVER_ADDRESS = process.env.SERVER_STACKS_ADDRESS!;

const TX_DELAY_MS = 500; // shorter delay OK now that we track nonces locally

// ── Local nonce tracking ──
// Instead of letting the SDK fetch nonce from the network each time
// (which returns stale values when prior TXs are still in mempool),
// we fetch once and increment locally after each successful broadcast.
let localNonce: bigint | null = null;

interface QueuedTx {
  contractAddress: string;
  contractName: string;
  functionName: string;
  functionArgs: any[];
  resolve: (txid: string) => void;
  reject: (err: Error) => void;
  _retries?: number;
}

const queue: QueuedTx[] = [];
let processing = false;

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  // Fetch nonce from network on first use or after a reset
  if (localNonce === null) {
    try {
      localNonce = await getNonce(SERVER_ADDRESS, NETWORK);
      console.log(`🔑 Fetched initial nonce from network: ${localNonce}`);
    } catch (e: any) {
      console.warn(`⚠️ Failed to fetch nonce: ${e.message}`);
      processing = false;
      return;
    }
  }

  while (queue.length > 0) {
    const item = queue.shift()!;
    try {
      const tx = await makeContractCall({
        contractAddress: item.contractAddress,
        contractName: item.contractName,
        functionName: item.functionName,
        functionArgs: item.functionArgs,
        senderKey: SERVER_PRIVATE_KEY,
        network: NETWORK,
        anchorMode: AnchorMode.Any,
        postConditionMode: PostConditionMode.Allow,
        nonce: localNonce,
      });

      const result = await broadcastTransaction(tx, NETWORK);

      if ("error" in result) {
        const reason = (result as any).reason || "";
        // If nonce is stale, re-fetch from network and retry (max 3 times)
        if (reason.includes("ConflictingNonceInMempool") || reason.includes("BadNonce")) {
          item._retries = (item._retries || 0) + 1;
          if (item._retries <= 3) {
            console.warn(`⚠️ Nonce conflict (nonce=${localNonce}), re-fetching... (retry ${item._retries}/3)`);
            localNonce = await getNonce(SERVER_ADDRESS, NETWORK);
            queue.unshift(item);
            await new Promise(r => setTimeout(r, TX_DELAY_MS * 2));
            continue;
          }
          console.warn(`⚠️ Nonce conflict persists after 3 retries, skipping ${item.functionName}`);
        }
        item.reject(new Error(`TX failed: ${item.functionName} — ${result.error} ${reason}`));
      } else {
        console.log(`✅ TX: ${item.functionName} → ${result.txid} (nonce=${localNonce})`);
        item.resolve(result.txid);
        localNonce++; // Increment locally for next TX
      }
    } catch (e: any) {
      item.reject(e);
    }

    // Short delay between TXs
    if (queue.length > 0) {
      await new Promise(r => setTimeout(r, TX_DELAY_MS));
    }
  }

  processing = false;
}

/**
 * Enqueue a contract call. Returns a promise that resolves with the txid.
 */
export function enqueueContractCall(
  contractAddress: string,
  contractName: string,
  functionName: string,
  functionArgs: any[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    queue.push({ contractAddress, contractName, functionName, functionArgs, resolve, reject });
    processQueue();
  });
}

export { NETWORK };
