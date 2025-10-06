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
 * Base Uniswap V3 tick fetcher
 * Fetches current tick data from Uniswap V3 pools on Base using multicall
 * Returns enhanced data with both tick and subnet_id
 */
export async function getCurrentTickPerPool(): Promise<
  Record<string, PoolTickData>
> {
  const startTime = Date.now();
  const tickData: Record<string, PoolTickData> = {};

  try {
    const multicall = getMulticallInstance();
    const sn106ContractAddress = CONFIG.BASE.SN106_CONTRACT_ADDRESS;

    if (!sn106ContractAddress) {
      throw new Error('Base SN106 contract address not configured');
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
        '📝 [Base/UniswapV3] Contract not deployed or configured - skipping',
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
        '📝 [Base/UniswapV3] Contract not properly configured - skipping',
      );
      return {};
    }

    if (poolAddresses.length === 0) {
      return {};
    }

    if (poolAddresses.length !== subnetIds.length) {
      logger.error(
        `❌ [Base/UniswapV3] Mismatch: ${poolAddresses.length} pools but ${subnetIds.length} subnet IDs`,
      );
      throw new Error('Pool addresses and subnet IDs array length mismatch');
    }

    const tickCalls = poolAddresses.map(poolAddress =>
      createContractCall(poolAddress, POOL_ABI, 'slot0', [], { poolAddress }),
    );

    const tickResults = await multicall.executeBatch(
      tickCalls,
      OPTIMIZED_MULTICALL_PARAMS.TICK_BATCH,
    );

    // Process tick results
    tickResults.forEach((result: any, idx: number) => {
      const poolAddress = tickCalls[idx].context.poolAddress;
      const subnetId = subnetIds[idx];

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
          `[Base] 🔹 Pool #${idx + 1}: ${poolAddress} -> tick: ${currentTick}, subnet: ${subnetId}`,
        );
      } catch (error) {
        logger.error(
          `❌ [Base/UniswapV3] Failed to decode tick for pool ${poolAddress}:`,
          error,
        );
      }
    });

    return tickData;
  } catch (error) {
    const totalTime = Date.now() - startTime;
    logger.error(
      `❌ [Base/UniswapV3] Tick fetch failed after ${totalTime}ms:`,
      error,
    );
    throw new Error(
      `Base Uniswap V3 tick fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
