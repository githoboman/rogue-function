/**
 * aibtcHeartbeat.ts — AIBTC network heartbeat
 *
 * Sends a signed check-in every 5 minutes to keep the agent
 * visible on the AIBTC leaderboard and inbox active.
 */

import * as crypto from "crypto";

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const BTC_ADDRESS = "bc1qzdwtvve2fj0nehys4xrx76k7nt40zawn3w94d7";

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let privKeyHex: string | null = null;

function sha256(data: Buffer): Buffer {
  return crypto.createHash("sha256").update(data).digest();
}

function bitcoinMessageHash(message: string): Buffer {
  const prefix = Buffer.from("\x18Bitcoin Signed Message:\n");
  const msgBuf = Buffer.from(message);
  const msgLen = Buffer.from([msgBuf.length]);
  return sha256(sha256(Buffer.concat([prefix, msgLen, msgBuf])));
}

async function initKey(): Promise<void> {
  if (privKeyHex) return;
  const { generateWallet } = await import("@stacks/wallet-sdk");
  const seed = process.env.AGENT_SEED_PHRASE;
  if (!seed) {
    console.warn("⚠️ AGENT_SEED_PHRASE not set — AIBTC heartbeat disabled");
    return;
  }
  const wallet = await generateWallet({ secretKey: seed, password: "" });
  const account = wallet.accounts[0];
  privKeyHex = account.stxPrivateKey;
  if (privKeyHex.length === 66) privKeyHex = privKeyHex.slice(0, 64);
}

async function sendHeartbeat(): Promise<void> {
  try {
    await initKey();
    if (!privKeyHex) return;

    const secp = await import("@noble/secp256k1");
    const timestamp = new Date().toISOString();
    const message = "AIBTC Check-In | " + timestamp;

    const btcHash = bitcoinMessageHash(message);
    const [sig, recovery] = await (secp as any).sign(btcHash, privKeyHex, { recovered: true, der: false });
    const flagByte = 39 + recovery;
    const compactSig = Buffer.concat([Buffer.from([flagByte]), Buffer.from(sig)]);
    const signature = compactSig.toString("base64");

    const res = await fetch("https://aibtc.com/api/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ btcAddress: BTC_ADDRESS, timestamp, signature }),
    });

    if (res.ok) {
      const data = await res.json() as any;
      console.log(`💓 AIBTC heartbeat #${data.checkIn?.checkInCount} — ${data.agent?.displayName}`);
      if (data.orientation?.unreadCount > 0) {
        console.log(`📬 ${data.orientation.unreadCount} unread messages in AIBTC inbox`);
      }
    } else {
      const err = await res.text();
      console.warn(`⚠️ AIBTC heartbeat failed (${res.status}):`, err);
    }
  } catch (e: any) {
    console.warn(`⚠️ AIBTC heartbeat error:`, e.message);
  }
}

export function startHeartbeat(): void {
  if (heartbeatTimer) return;
  console.log("💓 AIBTC heartbeat starting (every 5min)...");
  // Send first heartbeat immediately
  sendHeartbeat();
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
}

export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.log("💓 AIBTC heartbeat stopped");
  }
}
