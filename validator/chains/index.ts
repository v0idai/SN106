import { NFTPosition } from '../calculations/emissions';
import { logger } from '../../utils/logger';
import { CONFIG, SupportedChain } from '../../config/environment';
import { getAllNFTPositions as getSolanaPositions } from './solana/index';
import { getCurrentTickPerPool as getSolanaTicks, listActivePools as getSolanaActivePools, PoolTickData as SolanaPoolTickData } from './solana/index';
import { getAllNFTPositions as getEthereumPositions } from './ethereum/index';
import { getAllNFTPositions as getBasePositions } from './base/index';
import { getCurrentTickPerPool as getEthereumTicks } from './ethereum/index';
import { getCurrentTickPerPool as getBaseTicks } from './base/index';

/**
 * Multi-chain position fetcher
 * Fetches NFT positions from enabled chains only
 */
export async function getAllNFTPositions(
  hotkeys: string[],
): Promise<NFTPosition[]> {
  if (!hotkeys || hotkeys.length === 0) {
    logger.info('📝 No hotkeys provided');
    return [];
  }

  const enabledChains = CONFIG.getEnabledChains();
  logger.info(
    `🔍 Fetching NFT positions from enabled chains [${enabledChains.join(', ')}] for ${hotkeys.length} hotkeys`,
  );

  const allPositions: NFTPosition[] = [];
  const startTime = Date.now();

  try {
    // Process chains SEQUENTIALLY to avoid overwhelming RPC providers
    // This prevents rate limit issues when multiple chains fire calls simultaneously
    const results: NFTPosition[][] = [];
    const chainNames: string[] = [];

    if (enabledChains.includes('solana')) {
      logger.info('[Multi-chain] 🔍 Fetching Solana positions...');
      try {
        const solanaPositions = await getSolanaPositions(hotkeys);
        results.push(solanaPositions);
        chainNames.push('solana');
      } catch (error: unknown) {
        logger.error('❌ Solana position fetch failed:', error);
        results.push([]);
        chainNames.push('solana');
      }
    }

    if (enabledChains.includes('ethereum')) {
      logger.info('[Multi-chain] 🔍 Fetching Ethereum positions...');
      try {
        const ethereumPositions = await getEthereumPositions(hotkeys);
        results.push(ethereumPositions);
        chainNames.push('ethereum');
      } catch (error: unknown) {
        logger.error('❌ Ethereum position fetch failed:', error);
        results.push([]);
        chainNames.push('ethereum');
      }
    }

    if (enabledChains.includes('base')) {
      logger.info('[Multi-chain] 🔍 Fetching Base positions...');
      try {
        const basePositions = await getBasePositions(hotkeys);
        results.push(basePositions);
        chainNames.push('base');
      } catch (error: unknown) {
        logger.error('❌ Base position fetch failed:', error);
        results.push([]);
        chainNames.push('base');
      }
    }

    // Combine all positions
    results.forEach(positions => allPositions.push(...positions));

    const totalTime = Date.now() - startTime;
    logger.info(`✅ Multi-chain position fetch complete:`);

    // Log results for each enabled chain
    results.forEach((positions, index) => {
      const chainName = chainNames[index];
      logger.info(
        `  - ${chainName.charAt(0).toUpperCase() + chainName.slice(1)}: ${positions.length} positions`,
      );
    });

    logger.info(`  - Total: ${allPositions.length} positions`);
    logger.info(`  - Time: ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);

    return allPositions;
  } catch (error) {
    const totalTime = Date.now() - startTime;
    logger.error(
      `❌ Multi-chain position fetch failed after ${totalTime}ms:`,
      error,
    );
    throw new Error(
      `Multi-chain position fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

// Unified PoolTickData type (compatible with both Solana and Ethereum)
export type PoolTickData = SolanaPoolTickData; // They're identical

// Re-export SupportedChain type for external use
export type { SupportedChain };

/**
 * Multi-chain tick fetcher with enhanced data
 * Fetches current tick data from enabled chains only
 * Returns enhanced data with both tick and subnet_id
 */
export async function getCurrentTickPerPool(allowedPools?: Set<string>): Promise<Record<string, PoolTickData>> {
  const enabledChains = CONFIG.getEnabledChains();
  logger.info(
    `🔍 Fetching current tick data from enabled chains [${enabledChains.join(', ')}]`,
  );

  const allTicks: Record<string, PoolTickData> = {};
  const startTime = Date.now();

  try {
    // Process chains SEQUENTIALLY to avoid overwhelming RPC providers
    // This prevents rate limit issues when multiple chains fire calls simultaneously
    const results: Record<string, PoolTickData>[] = [];
    const chainNames: string[] = [];
    
    if (enabledChains.includes('solana')) {
      // Normalize allowed pool IDs to chain-specific format (strip chain prefix)
      logger.info('[Multi-chain] 🔍 Fetching Solana ticks...');
      let solanaAllowed: Set<string> | undefined = undefined;
      if (allowedPools && allowedPools.size > 0) {
        const arr = Array.from(allowedPools);
        const filtered = arr
          .filter(k => k.startsWith('solana:'))
          .map(k => k.slice('solana:'.length));
        if (filtered.length > 0) solanaAllowed = new Set(filtered);
      }
      results.push(await getSolanaTicks(solanaAllowed));
      chainNames.push('solana');
    }
    
    // if (enabledChains.includes('solana')) {
    //   try {
    //     const solanaTicks = await getSolanaTicks();
    //     results.push(solanaTicks);
    //     chainNames.push('solana');
    //   } catch (error: unknown) {
    //     logger.error('❌ Solana tick fetch failed:', error);
    //     results.push({});
    //     chainNames.push('solana');
    //   }
    // }

    if (enabledChains.includes('ethereum')) {
      // Normalize allowed pool IDs to chain-specific format (strip chain prefix)
      logger.info('[Multi-chain] 🔍 Fetching Ethereum ticks...');
      let ethereumAllowed: Set<string> | undefined = undefined;
      if (allowedPools && allowedPools.size > 0) {
        const arr = Array.from(allowedPools);
        const filtered = arr
          .filter(k => k.startsWith('ethereum:'))
          .map(k => k.slice('ethereum:'.length));
        if (filtered.length > 0) ethereumAllowed = new Set(filtered);
      }
      try {
        const ethereumTicks = await getEthereumTicks(ethereumAllowed);
        results.push(ethereumTicks);
        chainNames.push('ethereum');
      } catch (error: unknown) {
        logger.error('❌ Ethereum tick fetch failed:', error);
        results.push({});
        chainNames.push('ethereum');
      }
    }

    if (enabledChains.includes('base')) {
      // Normalize allowed pool IDs to chain-specific format (strip chain prefix)
      logger.info('[Multi-chain] 🔍 Fetching Base ticks...');
      let baseAllowed: Set<string> | undefined = undefined;
      if (allowedPools && allowedPools.size > 0) {
        const arr = Array.from(allowedPools);
        const filtered = arr
          .filter(k => k.startsWith('base:'))
          .map(k => k.slice('base:'.length));
        if (filtered.length > 0) baseAllowed = new Set(filtered);
      }
      try {
        const baseTicks = await getBaseTicks(baseAllowed);
        results.push(baseTicks);
        chainNames.push('base');
      } catch (error: unknown) {
        logger.error('❌ Base tick fetch failed:', error);
        results.push({});
        chainNames.push('base');
      }
    }

    // Combine enhanced ticks from enabled chains (with chain prefix to avoid conflicts)
    results.forEach((chainTicks, index) => {
      const chainName = chainNames[index];
      Object.assign(
        allTicks,
        Object.fromEntries(
          Object.entries(chainTicks).map(([pool, data]) => [
            `${chainName}:${pool}`,
            data,
          ]),
        ),
      );
    });

    const totalTime = Date.now() - startTime;
    logger.info(`✅ Multi-chain tick fetch complete:`);

    // Log results for each enabled chain
    results.forEach((chainTicks, index) => {
      const chainName = chainNames[index];
      logger.info(
        `  - ${chainName.charAt(0).toUpperCase() + chainName.slice(1)}: ${Object.keys(chainTicks).length} pools`,
      );
    });

    logger.info(`  - Total: ${Object.keys(allTicks).length} pools`);
    logger.info(`  - Time: ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);

    return allTicks;
  } catch (error) {
    const totalTime = Date.now() - startTime;
    logger.error(
      `❌ Multi-chain tick fetch failed after ${totalTime}ms:`,
      error,
    );
    throw new Error(
      `Multi-chain tick fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Get positions from a specific chain (respects chain filtering)
 */
export async function getPositionsByChain(
  chain: SupportedChain,
  hotkeys: string[],
): Promise<NFTPosition[]> {
  if (!CONFIG.isChainEnabled(chain)) {
    logger.info(`📝 Chain ${chain} is not enabled, returning empty positions`);
    return [];
  }

  switch (chain) {
    case 'solana':
      return await getSolanaPositions(hotkeys);
    case 'ethereum':
      return await getEthereumPositions(hotkeys);
    case 'base':
      return await getBasePositions(hotkeys);
    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}

/**
 * Get ticks from a specific chain (enhanced format, respects chain filtering)
 */
export async function getTicksByChain(
  chain: SupportedChain,
  allowedPools?: Set<string>,
): Promise<Record<string, PoolTickData>> {
  if (!CONFIG.isChainEnabled(chain)) {
    logger.info(`📝 Chain ${chain} is not enabled, returning empty ticks`);
    return {};
  }

  switch (chain) {
    case 'solana':
      return await getSolanaTicks(allowedPools);
    case 'ethereum':
      return await getEthereumTicks(allowedPools);
    case 'base':
      return await getBaseTicks(allowedPools);
    default:
      throw new Error(`Unsupported chain: ${chain}`);
  }
}

/**
 * Utility functions for chain management
 */

/**
 * Get list of enabled chains
 */
export function getEnabledChains(): SupportedChain[] {
  return CONFIG.getEnabledChains();
}

/**
 * Check if a specific chain is enabled
 */
export function isChainEnabled(chain: SupportedChain): boolean {
  return CONFIG.isChainEnabled(chain);
}

/**
 * Get all supported chains (regardless of enabled status)
 */
export function getAllSupportedChains(): SupportedChain[] {
  return ['solana', 'ethereum', 'base'];
}

/**
 * Multi-chain active pool lister (poolId without chain prefix, subnetId)
 */
export async function listActivePools(): Promise<Array<{ chain: SupportedChain; poolId: string; subnetId: number }>> {
  const enabledChains = CONFIG.getEnabledChains();
  const result: Array<{ chain: SupportedChain; poolId: string; subnetId: number }> = [];
  if (enabledChains.includes('solana')) {
    try {
      const pools = await getSolanaActivePools();
      for (const p of pools) {
        result.push({ chain: 'solana', poolId: p.poolId, subnetId: p.subnetId });
      }
    } catch (e) {
      logger.error('❌ Solana active pool list failed:', e);
    }
  }
  return result;
}

/**
 * Filter positions by enabled chains only
 */
export function filterPositionsByEnabledChains(
  positions: NFTPosition[],
): NFTPosition[] {
  const enabledChains = CONFIG.getEnabledChains();
  return positions.filter(position =>
    enabledChains.includes(position.chain as SupportedChain),
  );
}

/**
 * Filter tick data by enabled chains only
 */
export function filterTicksByEnabledChains(
  ticks: Record<string, PoolTickData>,
): Record<string, PoolTickData> {
  const enabledChains = CONFIG.getEnabledChains();
  const filteredTicks: Record<string, PoolTickData> = {};

  for (const [poolId, data] of Object.entries(ticks)) {
    const chain = poolId.split(':')[0] as SupportedChain;
    if (enabledChains.includes(chain)) {
      filteredTicks[poolId] = data;
    }
  }

  return filteredTicks;
}
