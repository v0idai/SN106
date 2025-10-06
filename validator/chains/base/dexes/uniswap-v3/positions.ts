import { NFTPosition } from '../../../../calculations/emissions';
import { logger } from '../../../../../utils/logger';
import { CONFIG } from '../../../../../config/environment';
import {
  getMulticallInstance,
  createContractCall,
  SN106_CONTRACT_ABI,
  POSITION_MANAGER_ABI,
  OPTIMIZED_MULTICALL_PARAMS,
} from '../../utils/multicall';

/**
 * Helper function to chunk array into smaller arrays
 */
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Base Uniswap V3 NFT position fetcher
 * Optimized for 256 hotkeys with chunked processing and rate limit handling
 */
export async function getAllNFTPositions(
  hotkeys: string[],
): Promise<NFTPosition[]> {
  if (!hotkeys || hotkeys.length === 0) {
    logger.info('📝 No hotkeys provided for Base Uniswap V3');
    return [];
  }

  const startTime = Date.now();
  const positions: NFTPosition[] = [];

  try {
    const multicall = getMulticallInstance();
    const sn106ContractAddress = CONFIG.BASE.SN106_CONTRACT_ADDRESS;
    const positionManagerAddress =
      CONFIG.BASE.UNISWAP_V3_POSITION_MANAGER_ADDRESS;

    if (!sn106ContractAddress) {
      throw new Error('Base SN106 contract address not configured');
    }

    logger.info(
      `[Base/UniswapV3] 🚀 Fetching stakes for ${hotkeys.length} hotkeys using optimized batch method`,
    );

    // ========================================================================
    // OPTIMIZED: Use getStakesByMultipleHotkeys() with chunking for stability
    // For 256 hotkeys, we split into chunks to avoid gas limit issues
    // Chunk size of 50 handles worst case: 50 hotkeys × 18 stakes = 900 stakes (~2.1M gas)
    // This is conservative and ensures stability even with variable stake counts
    // ========================================================================
    const HOTKEY_CHUNK_SIZE = 50; // Process 50 hotkeys per call (256 total = 6 chunks)
    const hotkeyChunks = chunkArray(hotkeys, HOTKEY_CHUNK_SIZE);
    
    logger.info(
      `[Base/UniswapV3] 📦 Processing ${hotkeyChunks.length} chunks of ${HOTKEY_CHUNK_SIZE} hotkeys each`,
    );

    const hotkeyTokenPairs: Array<{
      hotkey: string;
      tokenId: string;
      poolAddress: string;
    }> = [];

    // Process each chunk sequentially to avoid rate limits
    for (let chunkIdx = 0; chunkIdx < hotkeyChunks.length; chunkIdx++) {
      const chunk = hotkeyChunks[chunkIdx];
      
      logger.info(
        `[Base/UniswapV3] 📦 Processing chunk ${chunkIdx + 1}/${hotkeyChunks.length} (${chunk.length} hotkeys)`,
      );

      try {
        // Create single call for this chunk using optimized function
        const stakeCall = createContractCall(
          sn106ContractAddress,
          SN106_CONTRACT_ABI,
          'getStakesByMultipleHotkeys', // ✅ OPTIMIZED FUNCTION
          [chunk], // Pass entire chunk of hotkeys
        );

        const stakeResults = await multicall.executeBatch(
          [stakeCall],
          OPTIMIZED_MULTICALL_PARAMS.HOTKEY_BATCH,
        );

        // Decode the results
        const resultData = (stakeResults[0] as any).returnData || stakeResults[0];
        const decoded = multicall.decodeResult(
          ['uint256[][]', 'address[][]'], // Nested arrays
          resultData,
        );

        const allTokenIds = decoded[0] as any[][];
        const allPoolAddrs = decoded[1] as any[][];

        // Process results for each hotkey in this chunk
        allTokenIds.forEach((tokenIds: any[], hotkeyIdx: number) => {
          const hotkey = chunk[hotkeyIdx];
          const poolAddrs = allPoolAddrs[hotkeyIdx];

          tokenIds.forEach((tokenId: any, i: number) => {
            hotkeyTokenPairs.push({
              hotkey,
              tokenId: tokenId.toString(),
              poolAddress: poolAddrs[i],
            });
          });
        });

        logger.info(
          `[Base/UniswapV3] ✅ Chunk ${chunkIdx + 1}/${hotkeyChunks.length} processed: found ${allTokenIds.flat().length} positions`,
        );
      } catch (error: any) {
        const errorMessage = error?.message || String(error);
        
        if (
          errorMessage.includes('multicall: retries exceeded') ||
          errorMessage.includes('execution reverted')
        ) {
          logger.info(
            `📝 [Base/UniswapV3] Contract not deployed or chunk ${chunkIdx + 1} failed - continuing with other chunks`,
          );
          // Continue with next chunk instead of failing completely
          continue;
        } else {
          logger.error(
            `❌ [Base/UniswapV3] Failed to process chunk ${chunkIdx + 1}:`,
            error,
          );
          // For other errors, continue to next chunk
          continue;
        }
      }

      // Add delay between chunks to respect rate limits
      // Longer delay for more chunks = more conservative rate limiting
      if (chunkIdx < hotkeyChunks.length - 1) {
        const delay = hotkeyChunks.length > 4 ? 300 : 200; // 300ms for 5+ chunks
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    if (hotkeyTokenPairs.length === 0) {
      logger.info(
        '[Base/UniswapV3] ℹ️ No stakes found for any hotkeys',
      );
      return [];
    }

    logger.info(
      `[Base/UniswapV3] 🎯 Found ${hotkeyTokenPairs.length} total staked positions across ${hotkeys.length} hotkeys`,
    );

    const positionCalls = hotkeyTokenPairs.map(pair =>
      createContractCall(
        positionManagerAddress,
        POSITION_MANAGER_ABI,
        'positions',
        [pair.tokenId],
        pair,
      ),
    );

    const positionResults = await multicall.executeBatch(
      positionCalls,
      OPTIMIZED_MULTICALL_PARAMS.POSITION_BATCH,
    );

    // Process position results - now we already have pool addresses! (OPTIMIZED)
    positionResults.forEach((result: any, idx: number) => {
      const { hotkey, tokenId, poolAddress } = positionCalls[idx].context;

      try {
        const decoded = multicall.decodeResult(
          [
            'uint96', // nonce
            'address', // operator
            'address', // token0
            'address', // token1
            'uint24', // fee
            'int24', // tickLower
            'int24', // tickUpper
            'uint128', // liquidity
            'uint256', // feeGrowthInside0LastX128
            'uint256', // feeGrowthInside1LastX128
            'uint128', // tokensOwed0
            'uint128', // tokensOwed1
          ],
          result.returnData || result,
        );

        // Validate pool address
        if (
          poolAddress &&
          poolAddress !== '0x0000000000000000000000000000000000000000'
        ) {
          const position: NFTPosition = {
            miner: hotkey,
            chain: 'base',
            pool: `base:${poolAddress}`,
            tokenId: tokenId.toString(),
            tickLower: Number(decoded[5]),
            tickUpper: Number(decoded[6]),
            liquidity: Number(decoded[7]),
          };

          positions.push(position);
        } else {
          logger.warn(
            `⚠️ [Base/UniswapV3] Invalid pool address for token ${tokenId}`,
          );
        }
      } catch (error) {
        logger.error(
          `❌ [Base/UniswapV3] Failed to decode position for token ${tokenId}:`,
          error,
        );
      }
    });

    const totalTime = Date.now() - startTime;
    logger.info(
      `✅ [Base/UniswapV3] Position fetch complete: ${positions.length} positions in ${totalTime}ms`,
    );

    return positions;
  } catch (error) {
    const totalTime = Date.now() - startTime;
    logger.error(
      `❌ [Base/UniswapV3] Position fetch failed after ${totalTime}ms:`,
      error,
    );
    throw new Error(
      `Base Uniswap V3 position fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}
