import { Connection, PublicKey, GetMultipleAccountsConfig } from "@solana/web3.js";
import { NFTPosition } from "../../../../calculations/emissions";
import { decodeStakeRecord } from "./utils/decodeStakeRecord";
import { decodeCLMMPosition } from "./utils/decodeCLMMPosition";
import { logger } from "../../../../../utils/logger";
import { chunkArray, delay, withRetry, createConnection } from "./utils/common";
import { DecodedStakeRecord, HotkeyStakesSummary } from "./types";
import { CONFIG } from "../../../../../config/environment";

// ==== CONFIGURATION ====
const RPC_ENDPOINT = CONFIG.SOLANA.RPC_ENDPOINT;
const PROGRAM_ID = CONFIG.SOLANA.PROGRAM_ID;

// Optimized configuration for hotkey-based fetching (max 200 hotkeys)
const BATCH_CONFIG = {
  // Batch configuration for position fetching
  POSITION_BATCH_SIZE: CONFIG.PERFORMANCE.POSITION_BATCH_SIZE,
  MAX_CONCURRENT_BATCHES: CONFIG.PERFORMANCE.MAX_CONCURRENT_BATCHES,
  
  // Request timing
  BATCH_DELAY_MS: CONFIG.PERFORMANCE.BATCH_DELAY_MS,
  
  // Retry configuration
  MAX_RETRIES: CONFIG.PERFORMANCE.MAX_RETRIES,
  RETRY_BASE_DELAY_MS: CONFIG.PERFORMANCE.RETRY_BASE_DELAY_MS,
  
  // Timeouts
  RPC_TIMEOUT_MS: CONFIG.PERFORMANCE.RPC_TIMEOUT_MS,
};

/**
 * Solana NFT position fetcher
 * Fetches NFT positions from Solana programs (e.g., Raydium)
 */
export async function getAllNFTPositions(hotkeys: string[]): Promise<NFTPosition[]> {
  if (!hotkeys || hotkeys.length === 0) {
    logger.info("📝 No hotkeys provided for Solana");
    return [];
  }

  const connection = createConnection();
  const hotkeySet = new Set(hotkeys);
  const startTime = Date.now();
  
  try {
    // Fetch all program accounts
    const accounts = await withRetry(
      () => Promise.race([
        connection.getProgramAccounts(PROGRAM_ID),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('RPC timeout')), BATCH_CONFIG.RPC_TIMEOUT_MS)
        )
      ]),
      BATCH_CONFIG.MAX_RETRIES,
      'getProgramAccounts'
    );

    // Decode and group stakes by hotkey
    const hotkeyStakesMap = new Map<string, DecodedStakeRecord[]>();
   
    let foundHotkeys = new Set<string>();

    for (const { account, pubkey } of accounts) {
      try {
        const decoded = decodeStakeRecord(account.data);
        
        // Data validation
        if (!decoded.hotkey || decoded.hotkey.length === 0 || decoded.hotkey.length > 64) {
          continue;
        }

        foundHotkeys.add(decoded.hotkey);

        // Only process hotkeys we're interested in
        if (hotkeySet.has(decoded.hotkey)) {
          const stakeRecord: DecodedStakeRecord = {
            ...decoded,
            stakeRecordPda: pubkey
          };

          if (!hotkeyStakesMap.has(decoded.hotkey)) {
            hotkeyStakesMap.set(decoded.hotkey, []);
          }
          hotkeyStakesMap.get(decoded.hotkey)!.push(stakeRecord);
        }
      } catch (error) {
        continue;
      }
    }

    // Step 3: Analyze the distribution and validate data
    const hotkeysSummary: HotkeyStakesSummary[] = Array.from(hotkeyStakesMap.entries()).map(([hotkey, stakes]) => ({
      hotkey,
      stakeCount: stakes.length,
      stakes
    }));

    const totalMatchingStakes = hotkeysSummary.reduce((sum, h) => sum + h.stakeCount, 0);

    if (totalMatchingStakes === 0) {
      logger.info("[Solana] ✅ No matching stakes found for the provided hotkeys");
      return [];
    }

    // Extract all position PDAs for batch fetching
    const allStakes = hotkeysSummary.flatMap(h => h.stakes);
    const positionPDAs = allStakes.map(stake => stake.personalPositionStatePda);

    // Batch fetch all position account data
    const positionAccountInfos = await fetchPositionAccountsInBatches(connection, positionPDAs);

    // Process all positions
    const results: NFTPosition[] = [];
    const errors: string[] = [];

    for (let i = 0; i < allStakes.length; i++) {
      const stake = allStakes[i];
      const accountInfo = positionAccountInfos[i];

      if (!accountInfo || !accountInfo.data) {
        errors.push(`No position data for ${stake.personalPositionStatePda.toBase58()}`);
        continue;
      }

      try {
        const decoded = decodeCLMMPosition(accountInfo.data);
        
        const position: NFTPosition = {
          miner: stake.hotkey,
          chain: 'solana',
          pool: `solana:${stake.poolId.toBase58()}`,
          tokenId: stake.nftMint.toBase58(),
          tickLower: decoded.tick_lower_index || 0,
          tickUpper: decoded.tick_upper_index || 0,
          liquidity: Number(decoded.liquidity) || 0
        };

        results.push(position);
      } catch (error) {
        errors.push(`Failed to decode position for ${stake.personalPositionStatePda.toBase58()}: ${error}`);
      }
    }

    // Step 7: Final summary and validation
    const totalTime = Date.now() - startTime;
    const successRate = allStakes.length > 0 ? ((results.length / allStakes.length) * 100).toFixed(1) : '0';
    


    return results;

  } catch (error) {
    const totalTime = Date.now() - startTime;
    logger.error(`[Solana] ❌ Fatal error after ${totalTime}ms:`, error);
    throw new Error(`Solana NFT position fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Robust batch fetcher for position account data
 */
async function fetchPositionAccountsInBatches(
  connection: Connection, 
  positionPDAs: PublicKey[]
): Promise<(import("@solana/web3.js").AccountInfo<Buffer> | null)[]> {
  const batches = chunkArray(positionPDAs, BATCH_CONFIG.POSITION_BATCH_SIZE);
  const allResults: (import("@solana/web3.js").AccountInfo<Buffer> | null)[] = [];
  
  logger.info(`[Solana] 📦 Processing ${positionPDAs.length} PDAs in ${batches.length} batches`);

  for (let i = 0; i < batches.length; i += BATCH_CONFIG.MAX_CONCURRENT_BATCHES) {
    const batchGroup = batches.slice(i, i + BATCH_CONFIG.MAX_CONCURRENT_BATCHES);
    
    // Process batch group concurrently
    const batchPromises = batchGroup.map(async (batch, groupIndex) => {
      const batchIndex = i + groupIndex;
      
      return withRetry(async () => {
        logger.info(`[Solana] 📦 Fetching batch ${batchIndex + 1}/${batches.length} (${batch.length} accounts)`);
        
        const config: GetMultipleAccountsConfig = {
          commitment: "confirmed"
        };
        
        return await connection.getMultipleAccountsInfo(batch, config);
      }, BATCH_CONFIG.MAX_RETRIES, `batch ${batchIndex + 1}`);
    });

    try {
      const batchResults = await Promise.all(batchPromises);
      
      // Flatten results
      for (const batchResult of batchResults) {
        allResults.push(...batchResult);
      }

      logger.info(`[Solana] 📦 Completed ${Math.min(i + BATCH_CONFIG.MAX_CONCURRENT_BATCHES, batches.length)}/${batches.length} batch groups`);

      // Rate limiting between batch groups
      if (i + BATCH_CONFIG.MAX_CONCURRENT_BATCHES < batches.length) {
        await delay(BATCH_CONFIG.BATCH_DELAY_MS);
      }
    } catch (error) {
      logger.error(`[Solana] ❌ Batch group ${i} failed:`, error);
      throw error;
    }
  }

  return allResults;
} 