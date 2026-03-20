/**
 * blockchain.ts — Stacks Integration
 * Replaces the previous SKALE/thirdweb blockchain.ts
 *
 * Uses @stacks/transactions for contract calls
 * Uses @stacks/network for testnet/mainnet config
 */

import {
  makeContractCall,
  makeContractDeploy,
  broadcastTransaction,
  AnchorMode,
  PostConditionMode,
  stringAsciiCV,
  uintCV,
  principalCV,
  noneCV,
  someCV,
  bufferCVFromString,
  callReadOnlyFunction,
  cvToJSON,
  standardPrincipalCV,
} from "@stacks/transactions";
import { StacksTestnet, StacksMainnet } from "@stacks/network";
import { generateWallet, getStxAddress } from "@stacks/wallet-sdk";
import * as fs from "fs";
import * as path from "path";

// ============================================================
// CONFIG — set in shard/.env
// ============================================================

const USE_MAINNET = process.env.STACKS_NETWORK === "mainnet";
const NETWORK = USE_MAINNET ? new StacksMainnet() : new StacksTestnet();

// Your deployer/server wallet
const SERVER_PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY!;
const SERVER_ADDRESS = process.env.SERVER_STACKS_ADDRESS!; // e.g. ST1ABC...

// Contract addresses (set after deployment)
const GOLD_CONTRACT_ADDRESS = process.env.GOLD_CONTRACT_ADDRESS || SERVER_ADDRESS;
const GOLD_CONTRACT_NAME = "gold-token";

const CHARACTER_CONTRACT_ADDRESS = process.env.CHARACTER_CONTRACT_ADDRESS || SERVER_ADDRESS;
const CHARACTER_CONTRACT_NAME = "character-nft";

const ITEMS_CONTRACT_ADDRESS = process.env.ITEMS_CONTRACT_ADDRESS || SERVER_ADDRESS;
const ITEMS_CONTRACT_NAME = "items";

// ============================================================
// HELPER — broadcast a contract call transaction (via shared queue)
// ============================================================

import { enqueueContractCall } from "./txQueue";

async function callContract(
  contractAddress: string,
  contractName: string,
  functionName: string,
  functionArgs: any[],
  _senderKey: string = SERVER_PRIVATE_KEY
): Promise<string> {
  return enqueueContractCall(contractAddress, contractName, functionName, functionArgs);
}

// ============================================================
// HELPER — read-only contract calls (free, no transaction)
// ============================================================

async function readContract(
  contractAddress: string,
  contractName: string,
  functionName: string,
  functionArgs: any[],
  senderAddress: string = SERVER_ADDRESS
): Promise<any> {
  const result = await callReadOnlyFunction({
    contractAddress,
    contractName,
    functionName,
    functionArgs,
    network: NETWORK,
    senderAddress,
  });

  return cvToJSON(result);
}

// ============================================================
// GOLD TOKEN FUNCTIONS
// ============================================================

/**
 * Mint GOLD to a player after completing a quest
 * @param recipientAddress  Player's Stacks wallet address
 * @param amount            Amount in micro-gold (1 GOLD = 1_000_000)
 */
export async function mintGold(recipientAddress: string, amount: number): Promise<string> {
  console.log(`💰 Minting ${amount / 1_000_000} GOLD to ${recipientAddress}`);

  return callContract(
    GOLD_CONTRACT_ADDRESS,
    GOLD_CONTRACT_NAME,
    "mint",
    [uintCV(amount), standardPrincipalCV(recipientAddress)]
  );
}

/**
 * Get a player's GOLD balance
 */
export async function getGoldBalance(walletAddress: string): Promise<number> {
  const result = await readContract(
    GOLD_CONTRACT_ADDRESS,
    GOLD_CONTRACT_NAME,
    "get-balance",
    [standardPrincipalCV(walletAddress)]
  );
  return parseInt(result.value?.value || "0");
}

/**
 * Transfer GOLD (player buying from another player)
 * The sender must sign this transaction — use their private key
 */
export async function transferGold(
  senderPrivateKey: string,
  senderAddress: string,
  recipientAddress: string,
  amount: number
): Promise<string> {
  const tx = await makeContractCall({
    contractAddress: GOLD_CONTRACT_ADDRESS,
    contractName: GOLD_CONTRACT_NAME,
    functionName: "transfer",
    functionArgs: [
      uintCV(amount),
      standardPrincipalCV(senderAddress),
      standardPrincipalCV(recipientAddress),
      noneCV(), // memo
    ],
    senderKey: senderPrivateKey,
    network: NETWORK,
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
  });

  const result = await broadcastTransaction(tx, NETWORK);
  if ("error" in result) throw new Error(result.error);
  return result.txid;
}

// ============================================================
// CHARACTER NFT FUNCTIONS
// ============================================================

/**
 * Mint (spawn) a new character NFT for a player
 * Maps to your existing spawnCharacterNFT.ts workflow
 */
export async function mintCharacter(
  recipientAddress: string,
  name: string,
  race: number,   // 0=Human, 1=Elf, 2=Dwarf, 3=Orc
  classId: number // 0=Warrior, 1=Mage, 2=Ranger, 3=Cleric, 4=Rogue, 5=Paladin, 6=Necromancer, 7=Druid
): Promise<string> {
  console.log(`🧙 Minting character "${name}" (${race}/${classId}) for ${recipientAddress}`);

  return callContract(
    CHARACTER_CONTRACT_ADDRESS,
    CHARACTER_CONTRACT_NAME,
    "mint-character",
    [
      stringAsciiCV(name),
      uintCV(race),
      uintCV(classId),
      standardPrincipalCV(recipientAddress),
    ]
  );
}

/**
 * Award XP to a character after combat/quest
 */
export async function awardXP(characterTokenId: number, xpAmount: number): Promise<string> {
  console.log(`⭐ Awarding ${xpAmount} XP to character #${characterTokenId}`);

  return callContract(
    CHARACTER_CONTRACT_ADDRESS,
    CHARACTER_CONTRACT_NAME,
    "award-xp",
    [uintCV(characterTokenId), uintCV(xpAmount)]
  );
}

/**
 * Get full character data from chain
 */
export async function getCharacter(tokenId: number): Promise<any> {
  const result = await readContract(
    CHARACTER_CONTRACT_ADDRESS,
    CHARACTER_CONTRACT_NAME,
    "get-character",
    [uintCV(tokenId)]
  );
  return result.value;
}

/**
 * Get all character IDs owned by a wallet
 */
export async function getCharactersByWallet(walletAddress: string): Promise<number[]> {
  const result = await readContract(
    CHARACTER_CONTRACT_ADDRESS,
    CHARACTER_CONTRACT_NAME,
    "get-characters-by-wallet",
    [standardPrincipalCV(walletAddress)]
  );

  return (result.value || []).map((v: any) => parseInt(v.value));
}

// ============================================================
// ITEMS FUNCTIONS
// ============================================================

/**
 * Register a new item template (like setting up shop catalog)
 * Call once per item type on deployment
 */
export async function registerItemTemplate(template: {
  name: string;
  itemType: number;
  rarity: number;
  levelReq: number;
  attackBonus: number;
  defenseBonus: number;
  hpRestore: number;
  goldValue: number;
  uri: string;
}): Promise<string> {
  return callContract(
    ITEMS_CONTRACT_ADDRESS,
    ITEMS_CONTRACT_NAME,
    "register-item-template",
    [
      stringAsciiCV(template.name),
      uintCV(template.itemType),
      uintCV(template.rarity),
      uintCV(template.levelReq),
      uintCV(template.attackBonus),
      uintCV(template.defenseBonus),
      uintCV(template.hpRestore),
      uintCV(template.goldValue),
      stringAsciiCV(template.uri),
    ]
  );
}

/**
 * Mint an item to a player (shop purchase, quest reward, mob drop)
 */
export async function mintItem(
  recipientAddress: string,
  templateId: number,
  quantity: number = 1
): Promise<string> {
  console.log(`🗡️ Minting item template #${templateId} (x${quantity}) to ${recipientAddress}`);

  return callContract(
    ITEMS_CONTRACT_ADDRESS,
    ITEMS_CONTRACT_NAME,
    "mint-item",
    [
      uintCV(templateId),
      standardPrincipalCV(recipientAddress),
      uintCV(quantity),
    ]
  );
}

/**
 * Use a consumable (potion) — returns HP restore amount
 */
export async function useConsumable(
  playerPrivateKey: string,
  tokenId: number
): Promise<string> {
  const tx = await makeContractCall({
    contractAddress: ITEMS_CONTRACT_ADDRESS,
    contractName: ITEMS_CONTRACT_NAME,
    functionName: "use-consumable",
    functionArgs: [uintCV(tokenId)],
    senderKey: playerPrivateKey,
    network: NETWORK,
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
  });

  const result = await broadcastTransaction(tx, NETWORK);
  if ("error" in result) throw new Error(result.error);
  return result.txid;
}

/**
 * Get all items owned by a wallet
 */
export async function getWalletItems(walletAddress: string): Promise<number[]> {
  const result = await readContract(
    ITEMS_CONTRACT_ADDRESS,
    ITEMS_CONTRACT_NAME,
    "get-wallet-items",
    [standardPrincipalCV(walletAddress)]
  );
  return (result.value || []).map((v: any) => parseInt(v.value));
}

/**
 * Get item instance data
 */
export async function getItem(tokenId: number): Promise<any> {
  const result = await readContract(
    ITEMS_CONTRACT_ADDRESS,
    ITEMS_CONTRACT_NAME,
    "get-item",
    [uintCV(tokenId)]
  );
  return result.value;
}

// ============================================================
// QUEST COMPLETION — combines gold mint + xp award in sequence
// ============================================================

export async function completeQuest(params: {
  playerAddress: string;
  characterTokenId: number;
  goldReward: number;  // in full GOLD units (e.g. 150)
  xpReward: number;
}): Promise<void> {
  const { playerAddress, characterTokenId, goldReward, xpReward } = params;

  console.log(`🏆 Completing quest for player ${playerAddress}`);
  console.log(`   Rewards: ${goldReward} GOLD + ${xpReward} XP`);

  // Mint gold reward (convert to micro-gold)
  await mintGold(playerAddress, goldReward * 1_000_000);

  // Award XP to character
  await awardXP(characterTokenId, xpReward);

  console.log(`✅ Quest rewards distributed!`);
}

// ============================================================
// SHOP PURCHASE — burns gold + mints item
// ============================================================

export async function processPurchase(params: {
  playerAddress: string;
  playerPrivateKey: string;
  templateId: number;
  quantity: number;
  goldCost: number;
}): Promise<void> {
  const { playerAddress, playerPrivateKey, templateId, quantity, goldCost } = params;

  // Check balance first
  const balance = await getGoldBalance(playerAddress);
  const costInMicroGold = goldCost * 1_000_000;

  if (balance < costInMicroGold) {
    throw new Error(`Insufficient gold. Has ${balance / 1_000_000}, needs ${goldCost}`);
  }

  // Burn gold from player
  const burnTx = await makeContractCall({
    contractAddress: GOLD_CONTRACT_ADDRESS,
    contractName: GOLD_CONTRACT_NAME,
    functionName: "burn",
    functionArgs: [
      uintCV(costInMicroGold),
      standardPrincipalCV(playerAddress),
    ],
    senderKey: playerPrivateKey,
    network: NETWORK,
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
  });

  const burnResult = await broadcastTransaction(burnTx, NETWORK);
  if ("error" in burnResult) throw new Error(burnResult.error);

  // Mint item to player
  await mintItem(playerAddress, templateId, quantity);

  console.log(`🛒 Purchase complete: ${quantity}x item#${templateId} for ${goldCost} GOLD`);
}
