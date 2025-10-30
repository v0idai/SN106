import { NFTPosition } from '../../calculations/emissions';
import { logger } from '../../../utils/logger';
import { getAllNFTPositions as getUniswapV3Positions } from './dexes/uniswap-v3/positions';
import {
  getCurrentTickPerPool as getUniswapV3Ticks,
  PoolTickData,
} from './dexes/uniswap-v3/ticks';

// Re-export the interface for external use
export type { PoolTickData };

/**
 * Base chain position fetcher
 * Aggregates NFT positions from all supported DEXes on Base
 */
export async function getAllNFTPositions(
  hotkeys: string[],
): Promise<NFTPosition[]> {
  if (!hotkeys || hotkeys.length === 0) {
    logger.info('📝 No hotkeys provided for Base');
    return [];
  }

  const allPositions: NFTPosition[] = [];
  const startTime = Date.now();

  try {
    // Fetch positions from all DEXes concurrently
    const dexPromises = [
      getUniswapV3Positions(hotkeys).catch((error: unknown) => {
        // Check if it's a contract deployment issue vs actual error
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        if (
          errorMessage.includes('multicall: retries exceeded') ||
          errorMessage.includes('execution reverted') ||
          errorMessage.includes('contract may not be deployed')
        ) {
          logger.info(
            '📝 [Base/UniswapV3] Contract not deployed - skipping positions',
          );
        } else {
          logger.error(
            `❌ [Base/UniswapV3] Position fetch failed: ${errorMessage}`,
          );
        }
        return [];
      }),
      // Future DEXes can be added here
      // getAerodromePositions(hotkeys).catch((error: unknown) => {
      //   logger.error("❌ [Base/Aerodrome] Position fetch failed:", error);
      //   return [];
      // })
    ];

    const [uniswapV3Positions] = await Promise.all(dexPromises);

    // Combine all positions
    allPositions.push(...uniswapV3Positions);

    const totalTime = Date.now() - startTime;
    logger.info(`✅ [Base] Multi-DEX position fetch complete:`);
    logger.info(`  - Uniswap V3: ${uniswapV3Positions.length} positions`);
    logger.info(`  - Total: ${allPositions.length} positions`);
    logger.info(`  - Time: ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);

    return allPositions;
  } catch (error) {
    const totalTime = Date.now() - startTime;
    logger.error(
      `❌ [Base] Multi-DEX position fetch failed after ${totalTime}ms:`,
      error,
    );
    throw new Error(
      `Base multi-DEX position fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Base chain tick fetcher
 * Aggregates current tick data from all supported DEXes on Base
 * Returns enhanced data with both tick and subnet_id
 */
export async function getCurrentTickPerPool(allowedPools?: Set<string>): Promise<
  Record<string, PoolTickData>
> {
  const allTicks: Record<string, PoolTickData> = {};
  const startTime = Date.now();

  try {
    // Fetch ticks from all DEXes concurrently
    const dexPromises = [
      getUniswapV3Ticks(allowedPools).catch((error: unknown) => {
        // Check if it's a contract deployment issue vs actual error
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        if (
          errorMessage.includes('multicall: retries exceeded') ||
          errorMessage.includes('execution reverted') ||
          errorMessage.includes('contract may not be deployed')
        ) {
          logger.info(
            '📝 [Base/UniswapV3] Contract not deployed - skipping ticks',
          );
        } else {
          logger.error(
            `❌ [Base/UniswapV3] Tick fetch failed: ${errorMessage}`,
          );
        }
        return {};
      }),
      // Future DEXes can be added here
      // getAerodromeTicks(allowedPools).catch((error: unknown) => {
      //   logger.error("❌ [Base/Aerodrome] Tick fetch failed:", error);
      //   return {};
      // })
    ];

    const [uniswapV3Ticks] = await Promise.all(dexPromises);

    // Combine all ticks (no DEX prefix needed - main index adds chain prefix)
    Object.assign(allTicks, uniswapV3Ticks);
    // Future DEXes can be added here
    // Object.assign(allTicks, aerodromeTicks);

    const totalTime = Date.now() - startTime;
    logger.info(`✅ [Base] Multi-DEX tick fetch complete:`);
    logger.info(`  - Uniswap V3: ${Object.keys(uniswapV3Ticks).length} pools`);
    logger.info(`  - Total: ${Object.keys(allTicks).length} pools`);
    logger.info(`  - Time: ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);

    return allTicks;
  } catch (error) {
    const totalTime = Date.now() - startTime;
    logger.error(
      `❌ [Base] Multi-DEX tick fetch failed after ${totalTime}ms:`,
      error,
    );
    throw new Error(
      `Base multi-DEX tick fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
