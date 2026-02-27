import { NFTPosition } from '../validator/calculations/emissions';
import { PoolTickData } from '../validator/chains';


/**
 * Calculate pool weights with chain-aware allocation:
 * - 90% to subnet 0 pools, split equally between Solana and Ethereum (45% each)
 * - 10% to subnet 106 pools on Ethereum only (Solana subnet 106 gets 0)
 * - All other pools get 0
 */
export function calculatePoolWeightsWithReservedPools(
  positions: NFTPosition[],
  currentTickPerPool: Record<string, PoolTickData>,
  subnetAlphaPrices: Record<number, number>,
  filterNetuids: number[],
  reservedZeroSubnetShare: number = 0.90,
  reservedSubnet106Share: number = 0.10
): {
  subnetWeights: Record<number, number>;
  poolWeights: Record<string, number>;
  poolsBySubnet: Record<number, string[]>;
} {
  // Raw subnet weights from alpha prices (no normalization; used for proportional distribution)
  const subnetWeights: Record<number, number> = {};
  for (const subnetId of filterNetuids) {
    const alphaPrice = subnetAlphaPrices[subnetId] || 0;
    subnetWeights[subnetId] = alphaPrice;
  }

  // Group pools by subnet and chain
  const poolWeights: Record<string, number> = {};
  const poolsBySubnet: Record<number, string[]> = {};
  for (const pos of positions) {
    const tickData = currentTickPerPool[pos.pool];
    if (tickData) {
      const subnetId = tickData.subnetId;
      if (!poolsBySubnet[subnetId]) {
        poolsBySubnet[subnetId] = [];
      }
      if (!poolsBySubnet[subnetId].includes(pos.pool)) {
        poolsBySubnet[subnetId].push(pos.pool);
      }
    }
  }

  // Initialize all pools to zero
  for (const pools of Object.values(poolsBySubnet)) {
    for (const pool of pools) {
      poolWeights[pool] = 0;
    }
  }

  // Split subnet 0 pools by chain
  const zeroSubnetPools = poolsBySubnet[0] || [];
  const solanaSubnet0Pools = zeroSubnetPools.filter(p => p.startsWith('solana:'));
  const ethereumSubnet0Pools = zeroSubnetPools.filter(p => p.startsWith('ethereum:') || p.startsWith('base:'));

  // Split subnet 106 pools by chain (only Ethereum gets allocation)
  const subnet106Pools = poolsBySubnet[106] || [];
  const ethereumSubnet106Pools = subnet106Pools.filter(p => p.startsWith('ethereum:') || p.startsWith('base:'));
  const solanaSubnet106Pools = subnet106Pools.filter(p => p.startsWith('solana:'));

  // Allocate 90% to subnet 0, split equally between chains (45% each)
  // If only one chain has pools, that chain gets the full 90%
  const zeroShare = reservedZeroSubnetShare;
  const hasSolana = solanaSubnet0Pools.length > 0;
  const hasEthereum = ethereumSubnet0Pools.length > 0;
  let solanaSubnet0Share = 0;
  let ethereumSubnet0Share = 0;
  
  if (hasSolana && hasEthereum) {
    // Both chains have pools: split 45/45
    solanaSubnet0Share = zeroShare / 2; // 45%
    ethereumSubnet0Share = zeroShare / 2; // 45%
  } else if (hasSolana) {
    // Only Solana has pools: gets full 90%
    solanaSubnet0Share = zeroShare;
  } else if (hasEthereum) {
    // Only Ethereum has pools: gets full 90%
    ethereumSubnet0Share = zeroShare;
  }

  // Allocate 10% to subnet 106 on Ethereum only
  const subnet106Share = reservedSubnet106Share;
  const ethereumSubnet106Share = ethereumSubnet106Pools.length > 0 ? subnet106Share : 0; // 10%
  // Solana subnet 106 gets 0 (already initialized)

  // Assign subnet 0 pools: 45% to Solana, 45% to Ethereum
  if (solanaSubnet0Pools.length > 0) {
    const perSolanaPool = solanaSubnet0Share / solanaSubnet0Pools.length;
    for (const pool of solanaSubnet0Pools) {
      poolWeights[pool] = perSolanaPool;
    }
  }

  if (ethereumSubnet0Pools.length > 0) {
    const perEthereumPool = ethereumSubnet0Share / ethereumSubnet0Pools.length;
    for (const pool of ethereumSubnet0Pools) {
      poolWeights[pool] = perEthereumPool;
    }
  }

  // Assign subnet 106 pools: 10% to Ethereum only
  if (ethereumSubnet106Pools.length > 0 && ethereumSubnet106Share > 0) {
    const perEthereumSubnet106Pool = ethereumSubnet106Share / ethereumSubnet106Pools.length;
    for (const pool of ethereumSubnet106Pools) {
      poolWeights[pool] = perEthereumSubnet106Pool;
    }
  }

  // All other pools remain at 0 (already initialized)

  return {
    subnetWeights,
    poolWeights,
    poolsBySubnet
  };
}
