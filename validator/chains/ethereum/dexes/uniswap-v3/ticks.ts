/* eslint-disable @typescript-eslint/no-unused-vars */
import { logger } from '../../../../../utils/logger';
import { CONFIG } from '../../../../../config/environment';
import {
  getMulticallInstance,
  createContractCall,
  SN106_CONTRACT_ABI,
  POOL_ABI,
  OPTIMIZED_MULTICALL_PARAMS,
} from '../../utils/multicall';

// Define the return type for pool tick data
export interface PoolTickData {
  tick: number;
  subnetId: number;
}

/**
 * Ethereum Uniswap V3 tick fetcher
 * Fetches current tick data from Uniswap V3 pools on Ethereum using multicall
 * Returns enhanced data with both tick and subnet_id
 */
export async function getCurrentTickPerPool(allowedPools?: Set<string>): Promise<
  Record<string, PoolTickData>
> {
  const startTime = Date.now();
  const tickData: Record<string, PoolTickData> = {};
  const verbose = (process.env.LOG_VERBOSE_TICKS || '').toLowerCase() === 'true';

  try {
    const multicall = getMulticallInstance();
    const sn106ContractAddress = CONFIG.ETHEREUM.SN106_CONTRACT_ADDRESS;

    if (!sn106ContractAddress) {
      throw new Error('SN106 contract address not configured');
    }

    if (allowedPools) {
      const size = allowedPools.size;
      if (verbose) {
        const sample = Array.from(allowedPools).slice(0, 5);
        logger.info(`[Ethereum] 🔎 allowedPools size: ${size}; sample: ${JSON.stringify(sample)}`);
      } else {
        logger.info(`[Ethereum] 🔎 allowedPools size: ${size}`);
      }
    } else if (verbose) {
      logger.info(`[Ethereum] 🔎 allowedPools not provided; fetching all ticks`);
    }

    // Get all supported pool addresses from the contract
    const poolsCall = createContractCall(
      sn106ContractAddress,
      SN106_CONTRACT_ABI,
      'getAllPools',
      [],
    );

    let poolsResult;
    try {
      poolsResult = await multicall.executeBatch(
        [poolsCall],
        OPTIMIZED_MULTICALL_PARAMS.POOL_BATCH,
      );
    } catch (error) {
      logger.info(
        '📝 [Ethereum/UniswapV3] Contract not deployed or configured - skipping',
      );
      return {};
    }

    let poolAddresses: string[];
    let subnetIds: number[];
    try {
      const resultData = (poolsResult[0] as any).returnData || poolsResult[0];
      const decoded = multicall.decodeResult(
        ['address[]', 'uint8[]'],
        resultData,
      );
      poolAddresses = decoded[0] as string[];
      subnetIds = (decoded[1] as any[]).map(id => Number(id));
    } catch (error) {
      logger.info(
        '📝 [Ethereum/UniswapV3] Contract not properly configured - skipping',
      );
      return {};
    }

    if (poolAddresses.length === 0) {
      return {};
    }

    if (poolAddresses.length !== subnetIds.length) {
      logger.error(
        `❌ [Ethereum/UniswapV3] Mismatch: ${poolAddresses.length} pools but ${subnetIds.length} subnet IDs`,
      );
      throw new Error('Pool addresses and subnet IDs array length mismatch');
    }

    // Filter pools if allowedPools is provided
    let filteredPoolData: Array<{ address: string; subnetId: number }> = [];
    if (allowedPools && allowedPools.size > 0) {
      for (let i = 0; i < poolAddresses.length; i++) {
        const poolAddress = poolAddresses[i];
        if (allowedPools.has(poolAddress)) {
          filteredPoolData.push({ address: poolAddress, subnetId: subnetIds[i] });
        } else if (verbose) {
          logger.info(`[Ethereum] ⏭️ Skipping pool not in allowed set: ${poolAddress}`);
        }
      }
      logger.info(`[Ethereum] 📋 Filtered to ${filteredPoolData.length} pools from ${poolAddresses.length} total`);
    } else {
      // No filtering - use all pools
      filteredPoolData = poolAddresses.map((address, i) => ({ address, subnetId: subnetIds[i] }));
      logger.info(`[Ethereum] 📋 Processing all ${filteredPoolData.length} pools`);
    }

    if (filteredPoolData.length === 0) {
      logger.info('[Ethereum] ℹ️ No pools to fetch after filtering');
      return {};
    }

    const tickCalls = filteredPoolData.map(pool =>
      createContractCall(pool.address, POOL_ABI, 'slot0', [], { poolAddress: pool.address, subnetId: pool.subnetId }),
    );

    const tickResults = await multicall.executeBatch(
      tickCalls,
      OPTIMIZED_MULTICALL_PARAMS.TICK_BATCH,
    );

    // Process tick results
    tickResults.forEach((result: any, idx: number) => {
      const poolAddress = tickCalls[idx].context.poolAddress;
      const subnetId = tickCalls[idx].context.subnetId;

      try {
        const decoded = multicall.decodeResult(
          [
            'uint160', // sqrtPriceX96
            'int24', // tick (this is what we want)
            'uint16', // observationIndex
            'uint16', // observationCardinality
            'uint16', // observationCardinalityNext
            'uint8', // feeProtocol
            'bool', // unlocked
          ],
          result.returnData || result,
        );

        const currentTick = Number(decoded[1]);
        tickData[poolAddress] = {
          tick: currentTick,
          subnetId: subnetId,
        };

        // Log individual pool details
        logger.info(
          `[Ethereum] 🔹 Pool #${idx + 1}: ${poolAddress} -> tick: ${currentTick}, subnet: ${subnetId}`,
        );
      } catch (error) {
        logger.error(
          `❌ [Ethereum/UniswapV3] Failed to decode tick for pool ${poolAddress}:`,
          error,
        );
      }
    });

    const totalTime = Date.now() - startTime;
    logger.info(`✅ [Ethereum/UniswapV3] Tick fetch complete:`);
    logger.info(`  - Processed: ${filteredPoolData.length} pools`);
    logger.info(`  - Found tick data: ${Object.keys(tickData).length} pools`);
    logger.info(`  - Total time: ${totalTime}ms (${(totalTime/1000).toFixed(1)}s)`);

    return tickData;
  } catch (error) {
    const totalTime = Date.now() - startTime;
    logger.error(
      `❌ [Ethereum/UniswapV3] Tick fetch failed after ${totalTime}ms:`,
      error,
    );
    throw new Error(
      `Ethereum Uniswap V3 tick fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
