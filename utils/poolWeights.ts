import { NFTPosition } from '../validator/calculations/emissions';
import { PoolTickData } from '../validator/chains';


/**
 * Calculate pool weights with a reserved fixed share for subnetId 0 pools.
 *
 * Behavior:
 * - Reserve `reservedZeroSubnetShare` (default 0.25) for nom alpha token pools (split equally across them)
 * - Distribute the remaining share across non-zero subnets proportional to alpha prices
 * - Within each non-zero subnet, split its portion equally across its pools
 * - If all non-zero subnets have zero alpha, split the remaining share equally across all non-zero pools
 */
export function calculatePoolWeightsWithReservedPools(
  positions: NFTPosition[],
  currentTickPerPool: Record<string, PoolTickData>,
  subnetAlphaPrices: Record<number, number>,
  filterNetuids: number[],
  reservedZeroSubnetShare: number = 0.20,
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

  // Group pools by subnet
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

  // Reserve fixed shares for subnet id 0 and subnet id 106 pools
  const zeroSubnetPools = poolsBySubnet[0] || [];
  const subnet106Pools = poolsBySubnet[106] || [];
  const zeroShare = zeroSubnetPools.length > 0 ? Math.max(0, Math.min(1, reservedZeroSubnetShare)) : 0;
  const subnet106Share = subnet106Pools.length > 0 ? Math.max(0, Math.min(1 - zeroShare, reservedSubnet106Share)) : 0;
  const remainingShare = Math.max(0, 1 - zeroShare - subnet106Share);

  // Assign reserved share equally to subnet 0 pools
  if (zeroSubnetPools.length > 0) {
    const perZeroPool = zeroShare / zeroSubnetPools.length;
    for (const pool of zeroSubnetPools) {
      poolWeights[pool] = perZeroPool;
    }
  }

  // Assign reserved share equally to subnet 106 pools
  if (subnet106Pools.length > 0 && subnet106Share > 0) {
    const perSubnet106Pool = subnet106Pools.length > 0 ? subnet106Share / subnet106Pools.length : 0;
    for (const pool of subnet106Pools) {
      poolWeights[pool] = (poolWeights[pool] || 0) + perSubnet106Pool;
    }
  }

  // Distribute remaining share across non-zero subnets (excluding 0 and 106) based on alpha prices
  const nonZeroSubnetIds = Object.keys(poolsBySubnet)
    .map(x => Number(x))
    .filter(id => id !== 0 && id !== 106);

  const totalAlphaNonZero = nonZeroSubnetIds.reduce((sum, id) => sum + (subnetWeights[id] || 0), 0);

  if (nonZeroSubnetIds.length === 0) {
    // nothing to do, all weight already allocated to subnet 0 pools (if any)
  } else if (totalAlphaNonZero > 0) {
    // Price-weighted distribution across subnets, then equal per pool within subnet
    for (const subnetId of nonZeroSubnetIds) {
      const subnetAlpha = subnetWeights[subnetId] || 0;
      const subnetPortion = (subnetAlpha / totalAlphaNonZero) * remainingShare;
      const pools = poolsBySubnet[subnetId] || [];
      const perPool = pools.length > 0 ? subnetPortion / pools.length : 0;
      for (const pool of pools) {
        poolWeights[pool] = (poolWeights[pool] || 0) + perPool;
      }
    }
  } else {
    // Fallback: distribute remaining share equally across all non-zero pools
    const allNonZeroPools = nonZeroSubnetIds.flatMap(id => poolsBySubnet[id] || []);
    const perPool = allNonZeroPools.length > 0 ? remainingShare / allNonZeroPools.length : 0;
    for (const pool of allNonZeroPools) {
      poolWeights[pool] = (poolWeights[pool] || 0) + perPool;
    }
  }

  return {
    subnetWeights,
    poolWeights,
    poolsBySubnet
  };
}
