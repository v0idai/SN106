/**
 * This is the main validator code for sn106
 * 
 * Determines the weight of each miner and sets weight every interval.
 */

// Entry point for the BitTensor Subnet Validator
import { logger } from '../utils/logger';
import { CONFIG } from '../config/environment';
import { setWeightsOnSubtensor } from '../utils/setWeights';
import { getHotkeyToUidMap, getSubnetAlphaPrices } from '../utils/bittensor';
import { calculatePoolWeightsWithReservedPools } from '../utils/poolWeights';
import { getAllNFTPositions, getCurrentTickPerPool, listActivePools } from './chains';
import { calculatePoolwiseNFTEmissions } from './calculations/emissions';
import { subtensorClient } from './api';

async function runValidator() {
  logger.info('Starting validator run...');
  
  // Log enabled chains configuration
  const enabledChains = CONFIG.getEnabledChains();
  logger.info(`🔗 Enabled chains: [${enabledChains.join(', ')}]`);

  try {
    const wsUrl = CONFIG.SUBTENSOR.WS_URL;
    const hotkeyUri = CONFIG.SUBTENSOR.HOTKEY_URI;
    const netuid = CONFIG.SUBTENSOR.NETUID;

    // Initialize the singleton API client once for this run
    await subtensorClient.initialize(wsUrl);

    // EMA configuration/state (kept across scheduled runs)
    // Smooth weights over time and allow decay for missing miners
    const EMA_ALPHA: number = Number(CONFIG.VALIDATOR.EMA_ALPHA) || 0.3;
    // Persist EMA weights on module scope between runs
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (!global.__sn106EmaWeights) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      global.__sn106EmaWeights = {} as Record<string, number>;
    }
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const emaWeights: Record<string, number> = global.__sn106EmaWeights;

    const updateEma = (prev: Record<string, number>, curr: Record<string, number>): Record<string, number> => {
      const keys = new Set([...Object.keys(prev), ...Object.keys(curr)]);
      const next: Record<string, number> = {};
      for (const k of keys) {
        const prevVal = prev[k] ?? 0;
        const currVal = curr[k] ?? 0;
        const safePrev = isFinite(prevVal) ? prevVal : 0;
        const safeCurr = isFinite(currVal) ? currVal : 0;
        next[k] = EMA_ALPHA * safeCurr + (1 - EMA_ALPHA) * safePrev;
        if (!isFinite(next[k])) next[k] = 0;
      }
      return next;
    };

    // Get list of hotkeys to fetch positions for
    logger.info('Fetching hotkey-to-UID map from chain...');
    const [hotkeyToUid, mapError] = await getHotkeyToUidMap(wsUrl, netuid);
    if (mapError) {
      logger.error('Failed to fetch hotkey-to-UID map:', mapError);
    } 
    const hotkeys = Object.keys(hotkeyToUid);
    logger.info(`Fetched ${hotkeys.length} hotkeys from chain`);

    // 1. Gather all NFT positions using multi-chain data
    logger.info(`Fetching NFT positions for ${hotkeys.length} hotkeys...`);
    const positions = await getAllNFTPositions(hotkeys);
    logger.info(`Found ${positions.length} NFT positions across all chains`);

    // 2. Fetch supported pools (subnet mapping) first
    logger.info('Listing active pools (pool->subnet map)...');
    const activePools = await listActivePools();
    const poolsBySubnet: Record<number, string[]> = {};
    for (const p of activePools) {
      const key = `${p.chain}:${p.poolId}`;
      if (!poolsBySubnet[p.subnetId]) poolsBySubnet[p.subnetId] = [];
      poolsBySubnet[p.subnetId].push(key);
    }
    const supportedSubnetIds = Object.keys(poolsBySubnet).map(x => Number(x));

    // 3. Fetch alpha prices for all supported subnets
    logger.info('Fetching subnet-alpha-price map from chain (all supported)...');
    const [subnetAlphaPrices, err] = await getSubnetAlphaPrices(wsUrl, supportedSubnetIds);
    if (err) {
      logger.error('Failed to fetch subnet-alpha-price map:', err);
    } 
    logger.info(`Fetched ${Object.keys(subnetAlphaPrices).length} subnet alpha prices from chain`);

    // 4. Select relevant pools: subnet 0 and subnet 106 only
    const selectedPools = new Set<string>();
    for (const pool of (poolsBySubnet[0] || [])) selectedPools.add(pool);
    for (const pool of (poolsBySubnet[106] || [])) selectedPools.add(pool);

    logger.info(`Selected ${selectedPools.size} pools for tick fetching`);

    // 5. Fetch current ticks only for selected pools
    logger.info('Fetching current tick data for selected pools...');
    const currentTickPerPool = await getCurrentTickPerPool(selectedPools);
    logger.info(`Fetched tick data for ${Object.keys(currentTickPerPool).length} pools`);
    
    const filteredSubnetIds = [...new Set(Object.values(currentTickPerPool).map(p => p.subnetId))];

    // 6. Build pool weights with updated shares (85% subnet 0, 15% subnet 106)
    const { subnetWeights, poolWeights } = calculatePoolWeightsWithReservedPools(
      positions,
      currentTickPerPool,
      subnetAlphaPrices,
      filteredSubnetIds,
      0.85, // reserved share for subnet 0 pools
      0.15  // reserved share for subnet 106 pools
    );

    logger.info('Subnet weights (raw alpha prices):', subnetWeights);
    logger.info('Pool weights (after reserved share and alpha weighting):', poolWeights);

    // 7. Calculate per-NFT emissions pool-wise
    const nftEmissions = calculatePoolwiseNFTEmissions(positions, currentTickPerPool, poolWeights, 1.0);
    
    logger.info('Per-NFT emissions (pool-wise):', nftEmissions);
    
    // 8. Aggregate per-miner emissions
    const minerWeightsRaw = nftEmissions.reduce<Record<string, number>>((acc, nft) => {
      acc[nft.miner] = (acc[nft.miner] || 0) + nft.emission;
      return acc;
    }, {});

    // Build submission weights per requirements:
    // - If at least one miner has positive emission (in-range), submit weights for that miner only; all other UIDs get 0.
    // - If all emissions are zero (all out-of-range), submit uniform weights across ALL UIDs in the subnet.
    const hasPositiveEmission = Object.values(minerWeightsRaw).some(v => isFinite(v) && v > 0);

    let minerWeights: Record<string, number> = {};

    if (hasPositiveEmission) {
      // Initialize all known UIDs to 0
      for (const hotkey of Object.keys(hotkeyToUid)) {
        minerWeights[hotkey] = 0;
      }

      // EMA on eligible miners only
      if (CONFIG.VALIDATOR.USE_EMA) {
        const emaEligible: Record<string, number> = {};
        for (const [hotkey, w] of Object.entries(minerWeightsRaw)) {
          if (isFinite(w) && w > 0) emaEligible[hotkey] = w;
        }
        const nextEma = updateEma(emaWeights, emaEligible);
        // Save but only use for eligible miners this round
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        global.__sn106EmaWeights = nextEma;

        for (const [hotkey, w] of Object.entries(nextEma)) {
          const val = isFinite(w) && w > CONFIG.VALIDATOR.EMA_EPSILON ? w : 0;
          if (val > 0) minerWeights[hotkey] = val;
        }
      } else {
        // Assign only miners with positive emissions (no EMA)
        for (const [hotkey, w] of Object.entries(minerWeightsRaw)) {
          if (isFinite(w) && w > 0) {
            minerWeights[hotkey] = w;
          }
        }
      }
      logger.info('Submitting weights for in-range miners only; others set to 0.');
    } else {
      // All out-of-range: do not update EMA; submission helper will fallback to uniform over all UIDs
      logger.info('All staked NFTs are out-of-range. Submitting uniform weights across all UIDs.');
    }

    logger.info('Final miner weights (policy-applied):', minerWeights);

    // 6. Submit weights to Subtensor chain (setWeights handles uniform fallback if empty)
    logger.info('Submitting weights to Subtensor chain...');
    await setWeightsOnSubtensor(wsUrl, hotkeyUri, netuid, minerWeights, hotkeyToUid || {});
    logger.info('Validator run complete.');

  } catch (error) {
    logger.error('Error in validator run:', error);
  }
}

// Graceful shutdown handler
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  await subtensorClient.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  await subtensorClient.shutdown();
  process.exit(0);
});

// Scheduler: run every n minutes
setInterval(runValidator, Number(CONFIG.VALIDATOR_INTERVAL_MINUTES) * 60 * 1000);

runValidator();