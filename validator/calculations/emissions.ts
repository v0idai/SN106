// Emission and reward calculation logic for SN106
// Emissions are divided: chain -> pool -> NFT position -> miner

// Import PoolTickData type
import type { PoolTickData } from '../chains/index';

// Types
export interface NFTPosition {
  miner: string; // Bittensor hotkey or UID
  chain: string;
  pool: string;
  tokenId: string | number;
  tickLower: number;
  tickUpper: number;
  liquidity: number;
}

export interface NFTEmissionResult extends NFTPosition {
  currentTick: number;
  score: number;
  emission: number;
}

/**
 * Helper function to extract current tick from PoolTickData
 */
function findCurrentTick(position: NFTPosition, currentTickPerPool: Record<string, PoolTickData>): number | undefined {
  const tickData = currentTickPerPool[position.pool];
  return tickData?.tick;
}

function calculateRewardScore(position: NFTPosition, currentTick: number): number {
  const tickLower = position.tickLower;
  const tickUpper = position.tickUpper;
  const width = tickUpper - tickLower;
  const center = (tickLower + tickUpper) / 2;
  const distanceFromCenter = Math.abs(center - currentTick);
  const widthPenalty = 1 / Math.pow(width, 1.2); // Penalize wider ranges
  const centerWeight = 1 / (1 + distanceFromCenter); // Favor positions close to currentTick
  const baseScore = widthPenalty * centerWeight;
  return baseScore * position.liquidity; // Incorporate liquidity
}

/**
 * Calculates the emission for each NFT position across ALL pools (single global pot).
 */
function calculateNFTEmissions(
  positions: NFTPosition[],
  currentTickPerPool: Record<string, PoolTickData>,
  totalReward: number
): NFTEmissionResult[] {
  const scored = positions.map(pos => {
    const currentTick = findCurrentTick(pos, currentTickPerPool) || 0;
    const score = calculateRewardScore(pos, currentTick);
    return { ...pos, currentTick, score };
  });
  const totalScore = scored.reduce((sum, p) => sum + p.score, 0);
  return scored.map(pos => ({
    ...pos,
    emission: totalScore === 0 ? 0 : (pos.score / totalScore) * totalReward
  }));
}

/**
 * Calculates per-NFT emissions pool-wise using provided pool weights (sum to 1).
 * Each pool gets poolWeights[pool] portion of totalReward, allocated to its NFTs by score.
 */
export function calculatePoolwiseNFTEmissions(
  positions: NFTPosition[],
  currentTickPerPool: Record<string, PoolTickData>,
  poolWeights: Record<string, number>,
  totalReward: number
): NFTEmissionResult[] {
  // Group positions by pool
  const poolToPositions: Record<string, NFTPosition[]> = {};
  for (const pos of positions) {
    if (!poolToPositions[pos.pool]) poolToPositions[pos.pool] = [];
    poolToPositions[pos.pool].push(pos);
  }

  const results: NFTEmissionResult[] = [];
  for (const pool of Object.keys(poolToPositions)) {
    const poolReward = (poolWeights[pool] ?? 0) * totalReward;
    if (poolReward <= 0) continue;
    const inPool = poolToPositions[pool];
    const perPool = calculateNFTEmissions(inPool, currentTickPerPool, poolReward);
    results.push(...perPool);
  }
  return results;
}

// --- Main function: aggregate per-miner emissions from NFT emissions ---
export function calculateEmissionsAndRewards(
  positions: NFTPosition[],
  currentTickPerPool: Record<string, PoolTickData>,
  totalReward: number = 1.0
): Record<string, number> {
  const nftEmissions = calculateNFTEmissions(positions, currentTickPerPool, totalReward);
  const minerEmissions: Record<string, number> = {};
  for (const nft of nftEmissions) {
    minerEmissions[nft.miner] = (minerEmissions[nft.miner] || 0) + nft.emission;
  }
  return minerEmissions;
}

// --- Normalization: 2 decimal places, sum to 1.0 ---
export function normalizeWeights(weights: Record<string, number>): Record<string, number> {
  const entries = Object.entries(weights);
  const scaled = entries.map(([k, v]) => [k, v * 10000] as [string, number]);
  const floored = scaled.map(([k, v]) => [k, Math.floor(v)] as [string, number]);
  let total = floored.reduce((sum, [, v]) => sum + v, 0);
  let remainder = 10000 - total;
  const remainders = scaled.map(([k, v], i) => [i, v - Math.floor(v)] as [number, number]);
  remainders.sort((a, b) => b[1] - a[1]);
  for (let i = 0; i < remainder; i++) {
    floored[remainders[i][0]][1]++;
  }
  const normalized: Record<string, number> = {};
  for (const [k, v] of floored) {
    normalized[k] = v / 10000;
  }
  return normalized;
}