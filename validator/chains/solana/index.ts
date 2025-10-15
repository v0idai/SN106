import { NFTPosition } from '../../calculations/emissions';
import { logger } from '../../../utils/logger';
import { getAllNFTPositions as getRaydiumPositions } from './dexes/raydium/positions';
import { getCurrentTickPerPool as getRaydiumTicks, getActivePools as getRaydiumActivePools, PoolTickData } from './dexes/raydium/ticks';

// Re-export the interface for external use
export type { PoolTickData };

/**
 * Solana chain position fetcher
 * Aggregates NFT positions from all supported DEXes on Solana
 */
export async function getAllNFTPositions(hotkeys: string[]): Promise<NFTPosition[]> {
  if (!hotkeys || hotkeys.length === 0) {
    logger.info("📝 No hotkeys provided for Solana");
    return [];
  }

  const allPositions: NFTPosition[] = [];
  const startTime = Date.now();

  try {
    // Fetch positions from all DEXes concurrently
    const dexPromises = [
      getRaydiumPositions(hotkeys).catch((error: unknown) => {
        logger.error("❌ [Solana/Raydium] Position fetch failed:", error);
        return [];
      })
      // Future DEXes can be added here
      // getOrcaPositions(hotkeys).catch((error: unknown) => {
      //   logger.error("❌ [Solana/Orca] Position fetch failed:", error);
      //   return [];
      // })
    ];

    const [raydiumPositions] = await Promise.all(dexPromises);

    // Combine all positions
    allPositions.push(...raydiumPositions);

    const totalTime = Date.now() - startTime;
    logger.info(`✅ [Solana] Multi-DEX position fetch complete:`);
    logger.info(`  - Raydium: ${raydiumPositions.length} positions`);
    logger.info(`  - Total: ${allPositions.length} positions`);
    logger.info(`  - Time: ${totalTime}ms (${(totalTime/1000).toFixed(1)}s)`);

    return allPositions;

  } catch (error) {
    const totalTime = Date.now() - startTime;
    logger.error(`❌ [Solana] Multi-DEX position fetch failed after ${totalTime}ms:`, error);
    throw new Error(`Solana multi-DEX position fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Solana chain tick fetcher
 * Aggregates current tick data from all supported DEXes on Solana
 * Returns enhanced data with both tick and subnet_id
 */
export async function getCurrentTickPerPool(allowedPools?: Set<string>): Promise<Record<string, PoolTickData>> {
  const allTicks: Record<string, PoolTickData> = {};
  const startTime = Date.now();

  try {
    // Fetch ticks from all DEXes concurrently
    const dexPromises = [
      getRaydiumTicks(allowedPools).catch((error: unknown) => {
        logger.error("❌ [Solana/Raydium] Tick fetch failed:", error);
        return {};
      })
      // Future DEXes can be added here
      // getOrcaTicks().catch((error: unknown) => {
      //   logger.error("❌ [Solana/Orca] Tick fetch failed:", error);
      //   return {};
      // })
    ];

    const [raydiumTicks] = await Promise.all(dexPromises);

    // Combine all ticks (no DEX prefix needed - main index adds chain prefix)
    Object.assign(allTicks, raydiumTicks);
    // Future DEXes can be added here
    // Object.assign(allTicks, orcaTicks);

    const totalTime = Date.now() - startTime;
    logger.info(`✅ [Solana] Multi-DEX tick fetch complete:`);
    logger.info(`  - Raydium: ${Object.keys(raydiumTicks).length} pools`);
    logger.info(`  - Total: ${Object.keys(allTicks).length} pools`);
    logger.info(`  - Time: ${totalTime}ms (${(totalTime/1000).toFixed(1)}s)`);

    return allTicks;

  } catch (error) {
    const totalTime = Date.now() - startTime;
    logger.error(`❌ [Solana] Multi-DEX tick fetch failed after ${totalTime}ms:`, error);
    throw new Error(`Solana multi-DEX tick fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * List active pool IDs with subnet IDs on Solana.
 */
export async function listActivePools(): Promise<Array<{ poolId: string; subnetId: number }>> {
  try {
    const pools = await getRaydiumActivePools();
    return pools;
  } catch (error) {
    logger.error('❌ [Solana] Active pool list failed:', error);
    return [];
  }
}
