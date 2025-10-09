# Technical Implementation Guide

## Overview

This document provides detailed technical implementation details for the SN106 Validator, including code examples, data structures, and implementation patterns.

**Current Scope**: This document focuses on the **Solana implementation** which is currently fully supported and operational. Ethereum and Base support are planned for future releases.

**Coming Soon**: Multi-chain support for Ethereum (Uniswap V3) and Base (Uniswap V3) will be documented in future updates.

## Core Data Structures

### NFTPosition Interface

```typescript
export interface NFTPosition {
  miner: string;        // Bittensor hotkey or UID
  chain: string;        // Blockchain network identifier
  pool: string;         // Pool address with chain prefix (e.g., "solana:0x...")
  tokenId: string | number; // NFT token identifier
  tickLower: number;    // Lower tick boundary
  tickUpper: number;    // Upper tick boundary
  liquidity: number;    // Position liquidity amount
}
```

### PoolTickData Interface

```typescript
export interface PoolTickData {
  tick: number;         // Current tick value
  subnetId: number;     // Subnet identifier
}
```

### NFTEmissionResult Interface

```typescript
export interface NFTEmissionResult extends NFTPosition {
  currentTick: number;  // Current tick at calculation time
  score: number;        // Calculated reward score
  emission: number;     // Final emission amount
}
```

## Key Implementation Patterns

### 1. Chain-Aware Pool Identification

All pool identifiers include chain prefixes to ensure uniqueness across networks:

```typescript
// Solana (Currently Supported)
pool: `solana:${stake.poolId.toBase58()}`

// Coming Soon: Ethereum
// pool: `ethereum:${poolAddress}`

// Coming Soon: Base  
// pool: `base:${poolAddress}`
```

### 2. Subnet ID Integration

The validator fetches subnet IDs from multiple sources:

```typescript
// Solana: From PoolRecord accounts (Currently Supported)
const decoded = decodePoolRecord(account.data);
const subnetId = decoded.subnetId;

// Coming Soon: Ethereum/Base
// const [poolAddresses, subnetIds] = await getAllPools();
```

### 3. Error Handling with Result Tuples

Functions return tuples with data and error information:

```typescript
export async function getSubnetAlphaPrices(
  wsUrl: string,
  filterNetuids?: number[]
): Promise<[Record<number, number>, string | null]> {
  try {
    // ... implementation
    return [result, null];
  } catch (error: any) {
    return [{}, `Failed to fetch subnet alpha prices: ${error?.message || String(error)}`];
  }
}

// Usage
const [subnetAlphaPrices, err] = await getSubnetAlphaPrices(wsUrl, filteredSubnetIds);
if (err) {
  logger.error('Failed to fetch subnet-alpha-price map:', err);
}
```

## Solana Data Fetching (Currently Supported)

### Solana Implementation

#### NFT Position Fetching

```typescript
export async function getAllNFTPositions(hotkeys: string[]): Promise<NFTPosition[]> {
  const connection = createConnection();
  const hotkeySet = new Set(hotkeys);
  
  // 1. Fetch all program accounts
  const accounts = await connection.getProgramAccounts(PROGRAM_ID);
  
  // 2. Decode stake records
  const hotkeyStakesMap = new Map<string, DecodedStakeRecord[]>();
  
  for (const { account, pubkey } of accounts) {
    try {
      const decoded = decodeStakeRecord(account.data);
      
      if (hotkeySet.has(decoded.hotkey)) {
        if (!hotkeyStakesMap.has(decoded.hotkey)) {
          hotkeyStakesMap.set(decoded.hotkey, []);
        }
        hotkeyStakesMap.get(decoded.hotkey)!.push({
          ...decoded,
          stakeRecordPda: pubkey
        });
      }
    } catch (error) {
      continue; // Skip invalid accounts
    }
  }
  
  // 3. Fetch position data and create NFTPosition objects
  const results: NFTPosition[] = [];
  
  for (const [hotkey, stakes] of hotkeyStakesMap) {
    for (const stake of stakes) {
      const position: NFTPosition = {
        miner: hotkey,
        chain: 'solana',
        pool: `solana:${stake.poolId.toBase58()}`,
        tokenId: stake.nftMint.toBase58(),
        tickLower: decoded.tick_lower_index || 0,
        tickUpper: decoded.tick_upper_index || 0,
        liquidity: Number(decoded.liquidity) || 0
      };
      results.push(position);
    }
  }
  
  return results;
}
```

#### Tick Data Fetching

```typescript
export async function getCurrentTickPerPool(): Promise<Record<string, PoolTickData>> {
  const connection = createConnection();
  const results: Record<string, PoolTickData> = {};
  
  // 1. Fetch all pool record accounts
  const accounts = await connection.getProgramAccounts(PROGRAM_ID);
  
  // 2. Decode and validate pool records
  const poolRecords = accounts
    .map(({ account, pubkey }) => {
      try {
        const decoded = decodePoolRecord(account.data);
        if (decoded.poolId && decoded.admin && decoded.isActive) {
          return { ...decoded, poolRecordPda: pubkey };
        }
      } catch (error) {
        return null;
      }
      return null;
    })
    .filter(Boolean);
  
  // 3. Fetch current tick for each active pool
  for (const pool of poolRecords) {
    try {
      const accountInfo = await connection.getAccountInfo(pool.poolId);
      if (accountInfo?.data) {
        const decoded = decodePoolState(accountInfo.data);
        const tickCurrent = decoded.tick_current;
        
        if (tickCurrent !== null) {
          const poolId = pool.poolId.toBase58();
          results[poolId] = {
            tick: tickCurrent,
            subnetId: pool.subnetId
          };
        }
      }
    } catch (error) {
      logger.info(`⚠️ Could not fetch/parse PoolState for pool ${pool.poolId.toBase58()}: ${error}`);
      continue;
    }
  }
  
  return results;
}
```

### Ethereum/Base Implementation (Coming Soon)

> **Note**: The following sections describe Ethereum and Base implementations that are planned for future releases. Currently, only Solana is supported.

#### NFT Position Fetching

```typescript
export async function getAllNFTPositions(hotkeys: string[]): Promise<NFTPosition[]> {
  const multicall = getMulticallInstance();
  const positions: NFTPosition[] = [];
  
  // 1. Get staked token IDs for each hotkey
  const tokenIdCalls = hotkeys.map(hotkey => 
    createContractCall(
      sn106ContractAddress,
      SN106_CONTRACT_ABI,
      'getStakedTokens',
      [hotkey],
      { hotkey }
    )
  );
  
  const tokenIdResults = await multicall.executeBatch(tokenIdCalls, OPTIMIZED_MULTICALL_PARAMS.HOTKEY_BATCH);
  
  // 2. Process token ID results
  const hotkeyTokenPairs: Array<{ hotkey: string, tokenId: string }> = [];
  
  tokenIdResults.forEach((result: any, idx: number) => {
    const hotkey = tokenIdCalls[idx].context.hotkey;
    try {
      const decoded = multicall.decodeResult(['uint256[]'], result.returnData || result);
      const tokenIds = decoded[0] as any[];
      
      tokenIds.forEach((tokenId: any) => {
        hotkeyTokenPairs.push({ hotkey, tokenId: tokenId.toString() });
      });
    } catch (error) {
      logger.error(`❌ Failed to decode token IDs for hotkey ${hotkey}:`, error);
    }
  });
  
  // 3. Fetch position data
  const positionCalls = hotkeyTokenPairs.map(pair => 
    createContractCall(
      positionManagerAddress,
      POSITION_MANAGER_ABI,
      'positions',
      [pair.tokenId],
      pair
    )
  );
  
  const positionResults = await multicall.executeBatch(positionCalls, OPTIMIZED_MULTICALL_PARAMS.POSITION_BATCH);
  
  // 4. Resolve pool addresses and create positions
  const tempPositions = positionResults.map((result: any, idx: number) => {
    const { hotkey, tokenId } = positionCalls[idx].context;
    const decoded = multicall.decodeResult([
      "uint96", "address", "address", "uint24", "int24", "int24", "uint128"
    ], result.returnData || result);
    
    return {
      miner: hotkey,
      chain: 'ethereum', // or 'base'
      tokenId: tokenId,
      tickLower: Number(decoded[5]),
      tickUpper: Number(decoded[6]),
      liquidity: Number(decoded[7]),
      token0: decoded[2],
      token1: decoded[3],
      fee: decoded[4]
    };
  });
  
  // 5. Resolve pool addresses using factory
  const uniquePools = new Map<string, {token0: string, token1: string, fee: number}>();
  tempPositions.forEach((pos) => {
    const poolKey = `${pos.token0.toLowerCase()}-${pos.token1.toLowerCase()}-${pos.fee}`;
    uniquePools.set(poolKey, {token0: pos.token0, token1: pos.token1, fee: pos.fee});
  });
  
  const poolResolutionCalls = Array.from(uniquePools.entries()).map(([poolKey, poolData]) => 
    createContractCall(
      factoryAddress,
      ["function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"],
      'getPool',
      [poolData.token0, poolData.token1, poolData.fee],
      { poolKey }
    )
  );
  
  const poolResults = await multicall.executeBatch(poolResolutionCalls, OPTIMIZED_MULTICALL_PARAMS.POOL_BATCH);
  
  // 6. Create final positions with pool addresses
  const poolAddressMap = new Map<string, string>();
  poolResults.forEach((result: any, idx: number) => {
    const poolKey = poolResolutionCalls[idx].context.poolKey;
    const decoded = multicall.decodeResult(['address'], result.returnData || result);
    const poolAddress = decoded[0] as string;
    
    if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
      poolAddressMap.set(poolKey, poolAddress);
    }
  });
  
  // 7. Create final NFTPosition objects
  tempPositions.forEach((tempPos) => {
    const poolKey = `${tempPos.token0.toLowerCase()}-${tempPos.token1.toLowerCase()}-${tempPos.fee}`;
    const poolAddress = poolAddressMap.get(poolKey);
    
    if (poolAddress) {
      const position: NFTPosition = {
        miner: tempPos.miner,
        chain: tempPos.chain,
        pool: `${tempPos.chain}:${poolAddress}`,
        tokenId: tempPos.tokenId.toString(),
        tickLower: tempPos.tickLower,
        tickUpper: tempPos.tickUpper,
        liquidity: tempPos.liquidity
      };
      positions.push(position);
    }
  });
  
  return positions;
}
```

#### Tick Data Fetching

```typescript
export async function getCurrentTickPerPool(): Promise<Record<string, PoolTickData>> {
  const multicall = getMulticallInstance();
  const tickData: Record<string, PoolTickData> = {};
  
  // 1. Get all supported pool addresses and subnet IDs
  const [poolAddresses, subnetIds] = await getAllPools();
  
  if (poolAddresses.length === 0) {
    return {};
  }
  
  if (poolAddresses.length !== subnetIds.length) {
    throw new Error('Pool addresses and subnet IDs array length mismatch');
  }
  
  // 2. Create multicall for slot0() function
  const tickCalls = poolAddresses.map(poolAddress =>
    createContractCall(
      poolAddress,
      ["function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"],
      'slot0',
      [],
      { poolAddress }
    )
  );
  
  // 3. Execute batch call
  const results = await multicall.executeBatch(tickCalls, OPTIMIZED_MULTICALL_PARAMS.TICK_BATCH);
  
  // 4. Process results
  results.forEach((result: any, idx: number) => {
    const poolAddress = tickCalls[idx].context.poolAddress;
    const subnetId = subnetIds[idx];
    
    try {
      const decoded = multicall.decodeResult([
        "uint160", "int24", "uint16", "uint16", "uint16", "uint8", "bool"
      ], result.returnData || result);
      
      const currentTick = Number(decoded[1]);
      
      tickData[poolAddress] = {
        tick: currentTick,
        subnetId: subnetId
      };
      
      logger.info(`[Ethereum] 🔹 Pool #${idx + 1}: ${poolAddress} -> tick: ${currentTick}, subnet: ${subnetId}`);
    } catch (error) {
      logger.error(`❌ Failed to decode tick for pool ${poolAddress}:`, error);
    }
  });
  
  return tickData;
}
```

## Pool Weights Calculation

### Core Algorithm Implementation

```typescript
export function calculatePoolWeights(
  positions: NFTPosition[],
  currentTickPerPool: Record<string, PoolTickData>,
  subnetAlphaPrices: Record<number, number>,
  filterNetuids: number[]
): {
  subnetWeights: Record<number, number>;
  poolWeights: Record<string, number>;
  poolsBySubnet: Record<number, string[]>;
} {
  // Step 1: Calculate subnet weights based on alpha prices
  const subnetWeights: Record<number, number> = {};
  let totalAlphaPrice = 0;
  
  for (const subnetId of filterNetuids) {
    const alphaPrice = subnetAlphaPrices[subnetId] ?? 0;
    subnetWeights[subnetId] = alphaPrice;
    totalAlphaPrice += alphaPrice;
  }
  
  // Normalize subnet weights to sum to 1.0
  if (totalAlphaPrice > 0) {
    for (const subnetId of Object.keys(subnetWeights)) {
      subnetWeights[Number(subnetId)] = subnetWeights[Number(subnetId)] / totalAlphaPrice;
    }
  }
  
  // Step 2: Distribute subnet weights equally among pools within each subnet
  const poolWeights: Record<string, number> = {};
  const poolsBySubnet: Record<number, string[]> = {};
  
  // Group pools by subnet
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
  
  // Calculate pool weights
  for (const [subnetId, pools] of Object.entries(poolsBySubnet)) {
    const subnetWeight = subnetWeights[Number(subnetId)] || 0;
    const poolCount = pools.length;
    const poolWeight = poolCount > 0 ? subnetWeight / poolCount : 0;
    
    for (const pool of pools) {
      poolWeights[pool] = poolWeight;
    }
  }
  
  return {
    subnetWeights,
    poolWeights,
    poolsBySubnet
  };
}
```

## Emissions Calculation

### NFT Scoring Algorithm

```typescript
function calculateRewardScore(position: NFTPosition, currentTick: number): number {
  const tickLower = position.tickLower;
  const tickUpper = position.tickUpper;
  
  // Check if position is in range - out-of-range positions get zero score
  const isInRange = currentTick >= tickLower && currentTick <= tickUpper;
  if (!isInRange) {
    return 0;
  }
  
  const width = tickUpper - tickLower;
  const center = (tickLower + tickUpper) / 2;
  const distanceFromCenter = Math.abs(center - currentTick);
  
  // Penalize wider ranges (more concentrated positions get higher scores)
  const widthPenalty = 1 / Math.pow(width, 1.2);
  
  // Favor positions close to current tick
  const centerWeight = 1 / (1 + distanceFromCenter);
  
  // Base score combines width penalty and center weight
  const baseScore = widthPenalty * centerWeight;
  
  // Final score incorporates liquidity
  return baseScore * position.liquidity;
}
```

### Pool-Wise Emission Distribution

```typescript
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
  
  // Process each pool
  for (const pool of Object.keys(poolToPositions)) {
    // Each pool gets its allocated weight portion of total reward
    const poolReward = (poolWeights[pool] ?? 0) * totalReward;
    if (poolReward <= 0) continue;
    
    // NFTs within the pool compete for the pool's reward allocation
    const inPool = poolToPositions[pool];
    const perPool = calculateNFTEmissions(inPool, currentTickPerPool, poolReward);
    results.push(...perPool);
  }
  
  return results;
}
```

## EMA Implementation

### Weight Smoothing Algorithm

```typescript
const updateEma = (prev: Record<string, number>, curr: Record<string, number>): Record<string, number> => {
  const keys = new Set([...Object.keys(prev), ...Object.keys(curr)]);
  const next: Record<string, number> = {};
  
  for (const k of keys) {
    const prevVal = prev[k] ?? 0;
    const currVal = curr[k] ?? 0;
    const safePrev = isFinite(prevVal) ? prevVal : 0;
    const safeCurr = isFinite(currVal) ? currVal : 0;
    
    // EMA formula: α * current + (1-α) * previous
    next[k] = EMA_ALPHA * safeCurr + (1 - EMA_ALPHA) * safePrev;
    
    if (!isFinite(next[k])) next[k] = 0;
  }
  
  return next;
};
```

### EMA State Persistence

```typescript
// EMA configuration/state (kept across scheduled runs)
const EMA_ALPHA: number = Number(CONFIG.VALIDATOR.EMA_ALPHA) || 0.8;

// Persist EMA weights on module scope between runs
if (!global.__sn106EmaWeights) {
  global.__sn106EmaWeights = {} as Record<string, number>;
}

const emaWeights: Record<string, number> = global.__sn106EmaWeights;

// Update EMA for eligible miners only
if (CONFIG.VALIDATOR.USE_EMA) {
  const emaEligible: Record<string, number> = {};
  for (const [hotkey, w] of Object.entries(minerWeightsRaw)) {
    if (isFinite(w) && w > 0) emaEligible[hotkey] = w;
  }
  
  const nextEma = updateEma(emaWeights, emaEligible);
  global.__sn106EmaWeights = nextEma;
  
  // Apply EMA with epsilon threshold
  for (const [hotkey, w] of Object.entries(nextEma)) {
    const val = isFinite(w) && w > CONFIG.VALIDATOR.EMA_EPSILON ? w : 0;
    if (val > 0) minerWeights[hotkey] = val;
  }
}
```

## Chain Filtering Implementation

### Current Configuration (Solana Only)

```typescript
// config/environment.ts
export const CONFIG = {
  // ... other config
  ENABLED_CHAINS: process.env.ENABLED_CHAINS || 'SOLANA', // Currently Solana only
  // ... other config
} as const;

export type SupportedChain = 'solana'; // Currently only Solana

// validator/chains/index.ts
export function getEnabledChains(): SupportedChain[] {
  const chainsEnv = ENV.ENABLED_CHAINS.toUpperCase();
  
  // Currently only Solana is supported
  if (chainsEnv === 'ALL' || chainsEnv.includes('ETHEREUM') || chainsEnv.includes('BASE')) {
    console.warn('⚠️ Ethereum and Base support coming soon. Currently only Solana is supported.');
  }
  
  return ['solana']; // Force Solana only for now
}

export function isChainEnabled(chain: SupportedChain): boolean {
  return chain === 'solana'; // Currently only Solana
}

// Simplified implementation for Solana only
export async function getCurrentTickPerPool(): Promise<Record<string, PoolTickData>> {
  // Currently only Solana is supported
  const solanaTicks = await getSolanaTicks();
  
  // Add chain prefix to avoid conflicts when multi-chain support is added
  return Object.fromEntries(
    Object.entries(solanaTicks).map(([pool, data]) => [`solana:${pool}`, data])
  );
}
```

### Future Multi-Chain Support (Coming Soon)

When Ethereum and Base support are added, the configuration will expand to:

```typescript
// Future implementation
export type SupportedChain = 'solana' | 'ethereum' | 'base';

export function getEnabledChains(): SupportedChain[] {
  const chainsEnv = ENV.ENABLED_CHAINS.toUpperCase();
  const allChains: SupportedChain[] = ['solana', 'ethereum', 'base'];
  
  if (chainsEnv === 'ALL') {
    return allChains;
  }
  
  const enabledChains = chainsEnv
    .split(',')
    .map(chain => chain.trim().toLowerCase() as SupportedChain)
    .filter((chain): chain is SupportedChain => 
      allChains.includes(chain as SupportedChain)
    );
  
  return enabledChains.length > 0 ? enabledChains : allChains;
}
```

## Pool Weighting Implementation

### Reserved-Share Pool Weighting (Current v1 Behavior)

In v1, pool weights are computed with a reserved share for pools that belong to subnets with no alpha token price (historically identified as subnet id 0 in Solana data). The algorithm is implemented by `calculatePoolWeightsWithReservedPools(...)`.

Behavior:
- Reserve a fixed share (default 25%) for pools with no alpha token price. Split that share equally among those pools.
- Distribute the remaining share across pools in subnets with alpha prices:
  - First, proportionally across subnets by their alpha price
  - Then, equally among pools within each subnet
- If all non-zero-alpha subnets have zero alpha (degenerate case), split the remaining share equally among all non-zero pools

TypeScript (simplified):

```typescript
const { subnetWeights, poolWeights } = calculatePoolWeightsWithReservedPools(
  positions,
  currentTickPerPool,
  subnetAlphaPrices,
  filteredSubnetIds,
  0.25 // reserved share for pools with no alpha token 
);
```

Notes:
- This replaces the earlier equal-in-subnet distribution and ensures baseline incentives for pools without alpha token pricing while still rewarding higher priced subnets.
- The reserved share is configurable via the function argument so it can be tuned without code changes elsewhere.

## Performance Optimizations

### Multicall Configuration

```typescript
// utils/multicall.ts
export const OPTIMIZED_MULTICALL_PARAMS = {
  HOTKEY_BATCH: {
    maxBatchSize: 50,
    maxConcurrentBatches: 2,
    batchDelayMs: 50
  },
  POSITION_BATCH: {
    maxBatchSize: 100,
    maxConcurrentBatches: 3,
    batchDelayMs: 30
  },
  POOL_BATCH: {
    maxBatchSize: 200,
    maxConcurrentBatches: 2,
    batchDelayMs: 20
  },
  TICK_BATCH: {
    maxBatchSize: 500,
    maxConcurrentBatches: 1,
    batchDelayMs: 10
  }
};
```

### Batch Processing with Rate Limiting

```typescript
export async function executeBatch<T>(
  calls: ContractCall[],
  params: BatchParams
): Promise<T[]> {
  const batches = chunkArray(calls, params.maxBatchSize);
  const allResults: T[] = [];
  
  for (let i = 0; i < batches.length; i += params.maxConcurrentBatches) {
    const batchGroup = batches.slice(i, i + params.maxConcurrentBatches);
    
    // Process batch group concurrently
    const batchPromises = batchGroup.map(async (batch, groupIndex) => {
      const batchIndex = i + groupIndex;
      return withRetry(async () => {
        return await this.multicall.callSameFunction({
          contractAddress: this.address,
          abi: this.abi,
          functionName: 'aggregate',
          params: [batch.map(call => ({
            target: call.target,
            callData: call.callData
          }))]
        });
      }, this.maxRetries, `batch ${batchIndex + 1}`);
    });
    
    try {
      const batchResults = await Promise.all(batchPromises);
      
      // Flatten results
      for (const batchResult of batchResults) {
        allResults.push(...batchResult);
      }
      
      // Rate limiting between batch groups
      if (i + params.maxConcurrentBatches < batches.length) {
        await delay(params.batchDelayMs);
      }
    } catch (error) {
      throw error;
    }
  }
  
  return allResults;
}
```

## Error Handling Patterns

### Retry with Exponential Backoff

```typescript
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  operationName: string
): Promise<T> {
  let lastError: any = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt < maxRetries) {
        const delay = Math.min(
          INITIAL_RETRY_DELAY * Math.pow(2, attempt),
          MAX_RETRY_DELAY
        );
        await sleep(delay);
      }
    }
  }
  
  throw new Error(`${operationName} failed after ${maxRetries + 1} attempts: ${lastError?.message || 'Unknown error'}`);
}
```

### Graceful Degradation

```typescript
// Continue operation if individual chains fail
const chainPromises: Promise<Record<string, PoolTickData>>[] = [];

if (enabledChains.includes('solana')) {
  chainPromises.push(
    getSolanaTicks().catch((error: unknown) => {
      logger.error("❌ Solana tick fetch failed:", error);
      return {}; // Return empty result, don't fail entire operation
    })
  );
  chainNames.push('solana');
}

// Similar pattern for other chains...
```

## Testing and Validation

### Data Structure Validation

```typescript
// Validate NFT position data
function validateNFTPosition(pos: any): pos is NFTPosition {
  return (
    typeof pos.miner === 'string' &&
    typeof pos.chain === 'string' &&
    typeof pos.pool === 'string' &&
    (typeof pos.tokenId === 'string' || typeof pos.tokenId === 'number') &&
    typeof pos.tickLower === 'number' &&
    typeof pos.tickUpper === 'number' &&
    typeof pos.liquidity === 'number' &&
    pos.tickLower <= pos.tickUpper &&
    pos.liquidity > 0
  );
}

// Validate tick data
function validatePoolTickData(data: any): data is PoolTickData {
  return (
    typeof data.tick === 'number' &&
    typeof data.subnetId === 'number' &&
    Number.isInteger(data.subnetId) &&
    data.subnetId >= 0
  );
}
```

### Weight Calculation Validation

```typescript
// Validate that weights sum to expected total
function validateWeights(weights: Record<string, number>, expectedSum: number = 1.0): boolean {
  const sum = Object.values(weights).reduce((acc, val) => acc + val, 0);
  const tolerance = 0.0001; // Allow small floating point errors
  
  return Math.abs(sum - expectedSum) < tolerance;
}

// Validate subnet weights
function validateSubnetWeights(subnetWeights: Record<number, number>): boolean {
  const sum = Object.values(subnetWeights).reduce((acc, val) => acc + val, 0);
  return Math.abs(sum - 1.0) < 0.0001;
}
```

## Conclusion

This technical implementation guide provides the detailed code patterns and implementation specifics for the BitTensor Subnet 106 Validator. The modular architecture, comprehensive error handling, and performance optimizations ensure reliable operation across multiple blockchain networks while maintaining clean, maintainable code.

For additional implementation details, refer to the main architecture documentation and the source code comments throughout the codebase.
