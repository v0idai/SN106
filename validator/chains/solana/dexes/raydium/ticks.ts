import { Connection, PublicKey } from "@solana/web3.js";
import { logger } from "../../../../../utils/logger";
import { CONFIG } from "../../../../../config/environment";
import { withRetry, createConnection } from "./utils/common";

// ==== CONFIGURATION ====
const RPC_ENDPOINT = CONFIG.SOLANA.RPC_ENDPOINT;
const PROGRAM_ID = CONFIG.SOLANA.PROGRAM_ID;
const CLMM_PROGRAM_ID = CONFIG.SOLANA.CLMM_PROGRAM_ID;

// ===== Helper: Decode PoolRecord Account Data =====
function decodePoolRecord(buf: Buffer) {
  if (buf.length < 8) {
    throw new Error("Buffer too short for pool record");
  }

  // Anchor discriminator: 8 bytes
  let offset = 8;
  
  // pool_id: Pubkey (32 bytes)
  const poolId = new PublicKey(buf.slice(offset, offset + 32));
  offset += 32;
  
  // admin: Pubkey (32 bytes)
  const admin = new PublicKey(buf.slice(offset, offset + 32));
  offset += 32;
  
  // is_active: bool (1 byte)
  const isActive = buf[offset] === 1;
  offset += 1;
  
  // created_at: i64 (8 bytes)
  const createdAt = buf.readBigInt64LE(offset);
  offset += 8;
  
  // subnet_id: u8 (1 byte)
  const subnetId = buf[offset];
  offset += 1;

  return {
    poolId,
    admin,
    isActive,
    createdAt,
    subnetId
  };
}

// ===== Helper: Decode CLMM PoolState to get current tick =====
function decodePoolState(buf: Buffer) {
  if (buf.length < 177) {
    throw new Error(`Buffer too short. Expected at least 177 bytes, got ${buf.length}`);
  }

  function readBigUInt128LE(b: Buffer) {
    if (b.length !== 16) throw new Error("Expected 16 bytes for u128");
    const lo = b.readBigUInt64LE(0);
    const hi = b.readBigUInt64LE(8);
    return (hi << BigInt(64) | lo).toString();
  }

  // Skip discriminator (8 bytes)
  let offset = 8;
  
  // bump (1 byte)
  const bump = buf[offset];
  offset += 1;
  
  // amm_config (32 bytes)
  const amm_config = new PublicKey(buf.slice(offset, offset + 32));
  offset += 32;
  
  // owner (32 bytes)
  const owner = new PublicKey(buf.slice(offset, offset + 32));
  offset += 32;
  
  // token_mint_0 (32 bytes)
  const token_mint_0 = new PublicKey(buf.slice(offset, offset + 32));
  offset += 32;
  
  // token_mint_1 (32 bytes)
  const token_mint_1 = new PublicKey(buf.slice(offset, offset + 32));
  offset += 32;
  
  // token_vault_0 (32 bytes)
  const token_vault_0 = new PublicKey(buf.slice(offset, offset + 32));
  offset += 32;
  
  // token_vault_1 (32 bytes)
  const token_vault_1 = new PublicKey(buf.slice(offset, offset + 32));
  offset += 32;
  
  // observation_key (32 bytes)
  const observation_key = new PublicKey(buf.slice(offset, offset + 32));
  offset += 32;
  
  // mint_decimals_0 (1 byte)
  const mint_decimals_0 = buf[offset];
  offset += 1;
  
  // mint_decimals_1 (1 byte)
  const mint_decimals_1 = buf[offset];
  offset += 1;
  
  // tick_spacing (2 bytes)
  const tick_spacing = buf.readUInt16LE(offset);
  offset += 2;
  
  // liquidity (16 bytes - u128)
  const liquidity = readBigUInt128LE(buf.slice(offset, offset + 16));
  offset += 16;
  
  // sqrt_price_x64 (16 bytes - u128)
  const sqrt_price_x64 = readBigUInt128LE(buf.slice(offset, offset + 16));
  offset += 16;
  
  // tick_current (4 bytes - i32)
  const tick_current = buf.readInt32LE(offset);
  offset += 4;

  return {
    bump,
    amm_config: amm_config.toBase58(),
    owner: owner.toBase58(),
    token_mint_0: token_mint_0.toBase58(),
    token_mint_1: token_mint_1.toBase58(),
    token_vault_0: token_vault_0.toBase58(),
    token_vault_1: token_vault_1.toBase58(),
    observation_key: observation_key.toBase58(),
    mint_decimals_0,
    mint_decimals_1,
    tick_spacing,
    liquidity,
    sqrt_price_x64,
    tick_current, // This is the current tick!
  };
}

// Define the return type for pool tick data
export interface PoolTickData {
  tick: number;
  subnetId: number;
}

/**
 * Solana Raydium tick fetcher
 * Fetches current tick data from Raydium CLMM pools
 */
/**
 * Return a list of active pools with their subnet IDs (no tick fetch).
 */
export async function getActivePools(): Promise<Array<{ poolId: string; subnetId: number }>> {
  logger.info(`[Solana] 🔍 Listing active pools with subnet IDs`);
  const connection = createConnection();
  const pools: Array<{ poolId: string; subnetId: number }> = [];

  // Get all pool record accounts for the program
  const accounts = await withRetry(
    () => connection.getProgramAccounts(PROGRAM_ID),
    CONFIG.PERFORMANCE.MAX_RETRIES,
    'getProgramAccounts for pool records'
  );

  for (const { account, pubkey } of accounts) {
    try {
      const decoded = decodePoolRecord(account.data);
      if (!decoded.isActive) continue;
      // Use the poolId present in the pool record so it matches tick fetcher
      pools.push({ poolId: decoded.poolId.toBase58(), subnetId: decoded.subnetId });
    } catch {
      // ignore malformed accounts
    }
  }

  return pools;
}

export async function getCurrentTickPerPool(allowedPools?: Set<string>): Promise<Record<string, PoolTickData>> {
  logger.info(`🔍 [Solana] Fetching current tick data from Raydium CLMM pools`);
  logger.info(`📡 [Solana] RPC Endpoint: ${RPC_ENDPOINT}`);
  logger.info(`🏗️ [Solana] Program ID: ${PROGRAM_ID.toBase58()}`);
  logger.info(`🏗️ [Solana] CLMM Program ID: ${CLMM_PROGRAM_ID.toBase58()}`);
  const verbose = (process.env.LOG_VERBOSE_TICKS || '').toLowerCase() === 'true';
  if (allowedPools) {
    const size = allowedPools.size;
    if (verbose) {
      const sample = Array.from(allowedPools).slice(0, 5);
      logger.info(`[Solana] 🔎 allowedPools size: ${size}; sample: ${JSON.stringify(sample)}`);
    } else {
      logger.info(`[Solana] 🔎 allowedPools size: ${size}`);
    }
  } else if (verbose) {
    logger.info(`[Solana] 🔎 allowedPools not provided; fetching all ticks`);
  }

  const connection = createConnection();
  const startTime = Date.now();
  const results: Record<string, PoolTickData> = {};

  try {
    // Get all pool record accounts for the program
    logger.info("[Solana] 🔍 Fetching all pool record accounts...");
    const accounts = await withRetry(
      () => connection.getProgramAccounts(PROGRAM_ID),
      CONFIG.PERFORMANCE.MAX_RETRIES,
      'getProgramAccounts for pool records'
    );

    logger.info(`[Solana] 📊 Found ${accounts.length} total program accounts`);

    // Decode pool records
    const poolRecords: Array<{
      poolId: PublicKey;
      admin: PublicKey;
      isActive: boolean;
      createdAt: bigint;
      subnetId: number;
      poolRecordPda: PublicKey;
    }> = [];

    for (const { account, pubkey } of accounts) {
      try {
        // Check if this looks like a pool record by trying to decode it
        const decoded = decodePoolRecord(account.data);
        
        // Additional validation: check if poolId looks reasonable and pool is active
        if (decoded.poolId && decoded.admin && decoded.isActive) {
          poolRecords.push({
            ...decoded,
            poolRecordPda: pubkey
          });
        }
      } catch (error) {
        // Skip invalid accounts silently
        continue;
      }
    }

    if (poolRecords.length === 0) {
      logger.info("[Solana] ✅ No active pool records found.");
      return {};
    }

    logger.info(`[Solana] 📋 Processing ${poolRecords.length} active pool records with tick info...`);

    // For each active pool, fetch current tick information
    for (let index = 0; index < poolRecords.length; index++) {
      const pool = poolRecords[index];
      const idStr = pool.poolId.toBase58();
      if (allowedPools && !allowedPools.has(idStr)) {
        if (verbose) {
          logger.info(`[Solana] ⏭️ Skipping pool not in allowed set: ${idStr}`);
        }
        continue;
      }
      
      // Fetch and decode CLMM PoolState to get current tick
      let tickCurrent: number | null = null;
      try {
        const accountInfo = await withRetry(
          () => connection.getAccountInfo(pool.poolId),
          CONFIG.PERFORMANCE.MAX_RETRIES,
          `getAccountInfo for pool ${pool.poolId.toBase58()}`
        );
        
        if (accountInfo && accountInfo.data) {
          const decoded = decodePoolState(accountInfo.data);
          tickCurrent = decoded.tick_current;
        } else {
          throw new Error('PoolState account not found');
        }
      } catch (error) {
        logger.info(`[Solana] ⚠️ Could not fetch/parse PoolState for pool ${pool.poolId.toBase58()}: ${error}`);
        continue;
      }

      if (tickCurrent !== null) {
        const poolId = pool.poolId.toBase58();
        results[poolId] = {
          tick: tickCurrent,
          subnetId: pool.subnetId
        };
        
        logger.info(`[Solana] 🔹 Pool #${index + 1}: ${poolId} -> tick: ${tickCurrent}, subnet: ${pool.subnetId}`);
      }
    }

    const totalTime = Date.now() - startTime;
    logger.info(`[Solana] ✅ Tick fetch complete:`);
    logger.info(`[Solana]   - Processed: ${poolRecords.length} pools`);
    logger.info(`[Solana]   - Found tick data: ${Object.keys(results).length} pools`);
    logger.info(`[Solana]   - Total time: ${totalTime}ms (${(totalTime/1000).toFixed(1)}s)`);

    return results;

  } catch (error) {
    const totalTime = Date.now() - startTime;
    logger.error(`[Solana] ❌ Fatal error after ${totalTime}ms:`, error);
    throw new Error(`Solana tick fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
} 