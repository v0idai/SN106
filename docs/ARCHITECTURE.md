# Bittensor SN106 VoidAI Validator Architecture

## Overview

The Bittensor SN106 VoidAI Validator is a sophisticated system designed to calculate and distribute rewards to miners based on their NFT liquidity positions across supported blockchain networks. The validator implements a two-tier weighting system that considers both subnet performance (via alpha token prices) and individual NFT position characteristics.

## System Architecture

### High-Level Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Subtensor     │    │   Multi-Chain   │    │   Validator     │
│     Chain       │◄──►│   Data Fetch    │◄──►│   Engine       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Weight         │    │  Pool Weights   │    │  NFT Emissions  │
│ Submission      │    │  Calculation    │    │  Calculation    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Core Components

1. **Validator Engine** (`validator/index.ts`)
   - Main orchestration logic
   - EMA (Exponential Moving Average) weight management
   - Reward distribution policy enforcement

2. **Multi-Chain Data Layer** (`validator/chains/`)
   - Solana Raydium CLMM integration
   - Ethereum Uniswap V3 integration **(Coming Soon)**
   - Base Uniswap V3 integration **(Coming Soon)**
   - Chain filtering and configuration

3. **Emissions Calculator** (`validator/calculations/emissions.ts`)
   - NFT position scoring algorithm
   - Pool-wise emission distribution
   - Reward calculation logic

4. **Utility Layer** (`utils/`)
   - Bittensor chain interactions (`bittensor.ts`)
   - Pool weights calculation (`poolWeights.ts`)
   - Weight submission (`setWeights.ts`)

## Architecture Diagrams

### 1. Complete Emission Calculation Flow

```mermaid
graph TD
    A[Validator Start] --> B[Fetch Hotkey-to-UID Map]
    B --> C[Get NFT Positions from All Chains]
    C --> D[Fetch Current Tick Data]
    D --> E[Get Subnet Alpha Prices from Subtensor]
    
    E --> F[Calculate Subnet Weights]
    F --> G[Calculate Pool Weights - Reserved Share Logic]
    G --> H[Calculate NFT Emissions]
    H --> I[Aggregate Miner Weights]
    I --> J[Apply EMA if Enabled]
    J --> K[Enforce Distribution Policy]
    K --> L[Submit Weights to Subtensor]
    
    C --> C1[Solana Positions]
    C --> C2[Ethereum Positions]
    C --> C3[Base Positions]
    
    D --> D1[Solana Ticks]
    D --> D2[Ethereum Ticks]
    D --> D3[Base Ticks]
    
    F --> F1[Subnet 1 Weight]
    F --> F2[Subnet 2 Weight]
    F --> F3[Subnet N Weight]
    
    G --> G1[Pool A Weight]
    G --> G2[Pool B Weight]
    G --> G3[Pool C Weight]
    
    H --> H1[NFT 1 Emission]
    H --> H2[NFT 2 Emission]
    H --> H3[NFT N Emission]
    
    style A fill:#e1f5fe
    style L fill:#c8e6c9
    style F fill:#fff3e0
    style G fill:#fff3e0
    style H fill:#fff3e0
```

### 2. Subnet Weighting System

```mermaid
graph LR
    A[Subnet Alpha Prices] --> B[Subnet Weight Calculation]
    B --> C[Subnet Weights]
    
    A1[Subnet 1: a1 = 1.0] --> B
    A2[Subnet 2: a2 = 1.02] --> B
    A3[Subnet 3: a3 = 0.98] --> B
    
    B --> B1[Total = a1 + a2 + a3 = 3.0]
    B --> B2[Normalize: ai / Total]
    
    C --> C1[Subnet 1: 0.333]
    C --> C2[Subnet 2: 0.340]
    C --> C3[Subnet 3: 0.327]
    
    style A fill:#e3f2fd
    style C fill:#e8f5e8
    style B fill:#fff3e0
```

### 3. Pool Weight Distribution (Reserved-Share Logic)

```mermaid
graph TD
    A[Subnet Weights] --> B[Pool Grouping by Subnet]
    B --> C[Reserved Share for No-Alpha Pools + Proportional Distribution]
    
    A1[Subnet 1: 0.333] --> B1[Subnet 1 Pools]
    A2[Subnet 2: 0.340] --> B2[Subnet 2 Pools]
    A3[Subnet 3: 0.327] --> B3[Subnet 3 Pools]
    
    B1 --> B1A[Pool A1]
    B1 --> B1B[Pool B1]
    B1 --> B1C[Pool C1]
    
    B2 --> B2A[Pool A2]
    B2 --> B2B[Pool B2]
    
    B3 --> B3A[Pool A3]
    B3 --> B3B[Pool B3]
    B3 --> B3C[Pool C3]
    
    C --> C0[Reserve e.g., 0.25 equally for non-alpha pools]
    C --> C2[Distribute remaining proportionally by alpha, equal within each subnet]
    
    style A fill:#e3f2fd
    style C fill:#e8f5e8
    style B fill:#fff3e0
```

### 4. NFT Position Scoring Algorithm

```mermaid
graph TD
    A[NFT Position] --> B[Calculate Position Width]
    A --> C[Calculate Distance from Current Tick]
    A --> D[Get Position Liquidity]
    
    B --> B1[Width = tickUpper - tickLower]
    B --> B2[Width Penalty = 1 / width power 1.2]
    
    C --> C1[Center = tickLower + tickUpper / 2]
    C --> C2[Distance = center - currentTick]
    C --> C3[Center Weight = 1 / 1 + distance]
    
    D --> D1[Liquidity Value]
    
    B2 --> E[Base Score = Width Penalty x Center Weight]
    C3 --> E
    E --> F[Final Score = Base Score x Liquidity]
    
    style A fill:#e1f5fe
    style F fill:#c8e6c9
    style E fill:#fff3e0
```

### 5. Pool-Wise Emission Distribution

```mermaid
graph TD
    A[Total Reward Pool] --> B[Distribute by Pool Weights]
    B --> C[Pool-Specific Reward Allocation]
    
    B --> B1[Pool A: 0.111 x Total]
    B --> B2[Pool B: 0.170 x Total]
    B --> B3[Pool C: 0.109 x Total]
    
    C --> C1[Pool A NFTs Compete for Pool A Reward]
    C --> C2[Pool B NFTs Compete for Pool B Reward]
    C --> C3[Pool C NFTs Compete for Pool C Reward]
    
    C1 --> D1[NFT 1 Score: 1000]
    C1 --> D2[NFT 2 Score: 800]
    C1 --> D3[NFT 3 Score: 600]
    
    C2 --> E1[NFT 4 Score: 1200]
    C2 --> E2[NFT 5 Score: 900]
    
    C3 --> F1[NFT 6 Score: 700]
    C3 --> F2[NFT 7 Score: 500]
    C3 --> F3[NFT 8 Score: 300]
    
    D1 --> G1[NFT 1 Emission: 0.417 x Pool A Reward]
    D2 --> G2[NFT 2 Emission: 0.333 x Pool A Reward]
    D3 --> G3[NFT 3 Emission: 0.250 x Pool A Reward]
    
    E1 --> H1[NFT 4 Emission: 0.571 x Pool B Reward]
    E2 --> H2[NFT 5 Emission: 0.429 x Pool B Reward]
    
    F1 --> I1[NFT 6 Emission: 0.467 x Pool C Reward]
    F2 --> I2[NFT 7 Emission: 0.333 x Pool C Reward]
    F3 --> I3[NFT 8 Emission: 0.200 x Pool C Reward]
    
    style A fill:#e1f5fe
    style G1 fill:#c8e6c9
    style G2 fill:#c8e6c9
    style G3 fill:#c8e6c9
    style H1 fill:#c8e6c9
    style H2 fill:#c8e6c9
    style I1 fill:#c8e6c9
    style I2 fill:#c8e6c9
    style I3 fill:#c8e6c9
```

### 6. Multi-Chain Data Flow

```mermaid
graph TD
    A[Validator Engine] --> B[Chain Filtering]
    B --> C[Enabled Chains Only]
    
    C --> D1[Solana Chain]
    C --> D2[Ethereum Chain]
    C --> D3[Base Chain]
    
    D1 --> E1[Fetch Raydium CLMM Positions]
    D1 --> F1[Fetch PoolState Ticks]
    
    D2 --> E2[Fetch Uniswap V3 Positions]
    D2 --> F2[Fetch slot0 Ticks]
    
    D3 --> E3[Fetch Uniswap V3 Positions]
    D3 --> F3[Fetch slot0 Ticks]
    
    E1 --> G1[Solana NFT Positions]
    E2 --> G2[Ethereum NFT Positions]
    E3 --> G3[Base NFT Positions]
    
    F1 --> H1[Solana Tick Data]
    F2 --> H2[Ethereum Tick Data]
    F3 --> H3[Base Tick Data]
    
    G1 --> I[Unified NFT Position Array]
    G2 --> I
    G3 --> I
    
    H1 --> J[Unified Tick Data with Chain Prefixes]
    H2 --> J
    H3 --> J
    
    I --> K[Pool Weights Calculation]
    J --> K
    
    K --> L[Emissions Calculation]
    L --> M[Weight Submission]
    
    style A fill:#e1f5fe
    style M fill:#c8e6c9
    style K fill:#fff3e0
    style L fill:#fff3e0
```

### 7. EMA Weight Smoothing

```mermaid
graph TD
    A[Current Raw Weights] --> B[EMA Calculation]
    B --> C[Smoothed Weights]
    
    A1[Miner 1: 0.8] --> B
    A2[Miner 2: 0.2] --> B
    A3[Miner 3: 0.0] --> B
    
    B --> B1[EMA Formula: a x Current + 1-a x Previous]
    B --> B2[a = 0.3 Configurable]
    
    B1 --> C1[Miner 1: 0.3 x 0.8 + 0.7 x 0.6 = 0.66]
    B1 --> C2[Miner 2: 0.3 x 0.2 + 0.7 x 0.4 = 0.34]
    B1 --> C3[Miner 3: 0.3 x 0.0 + 0.7 x 0.0 = 0.00]
    
    C --> D[Apply Epsilon Threshold]
    D --> E[Final Weights for Submission]
    
    D --> D1[Epsilon = 0.001]
    D --> D2[Weights below epsilon set to 0]
    
    E --> E1[Miner 1: 0.66]
    E --> E2[Miner 2: 0.34]
    E --> E3[Miner 3: 0.00]
    
    style A fill:#e1f5fe
    style E fill:#c8e6c9
    style B fill:#fff3e0
```

### 8. Distribution Policy Enforcement

```mermaid
graph TD
    A[Calculate All NFT Emissions] --> B{Any Positive Emissions?}
    
    B -->|Yes| C[In-Range Miners Policy]
    B -->|No| D[Out-of-Range Policy]
    
    C --> C1[Set all UIDs to 0]
    C --> C2[Assign weights only to positive emissions]
    C --> C3[Apply EMA if enabled]
    
    D --> D1[Do not update EMA]
    D --> D2[Fallback to uniform distribution]
    D --> D3[All UIDs get equal weight]
    
    C --> E[Final Weight Assignment]
    D --> E
    
    E --> F[Submit to Subtensor Chain]
    
    C1 --> C1A[UID 1: 0]
    C1 --> C1B[UID 2: 0]
    C1 --> C1C[UID 3: 0.66]
    C1 --> C1D[UID 4: 0]
    C1 --> C1E[UID 5: 0.34]
    
    D1 --> D1A[UID 1: 0.2]
    D1 --> D1B[UID 2: 0.2]
    D1 --> D1C[UID 3: 0.2]
    D1 --> D1D[UID 4: 0.2]
    D1 --> D1E[UID 5: 0.2]
    
    style A fill:#e1f5fe
    style F fill:#c8e6c9
    style C fill:#e8f5e8
    style D fill:#ffebee
```

### 9. Error Handling and Resilience

```mermaid
graph TD
    A[Operation Start] --> B{Operation Success?}
    
    B -->|Yes| C[Return Success Result]
    B -->|No| D[Retry Logic]
    
    D --> D1[Increment Retry Count]
    D1 --> D2{Max Retries Reached?}
    
    D2 -->|No| D3[Exponential Backoff]
    D3 --> D4[Retry Operation]
    D4 --> B
    
    D2 -->|Yes| E[Graceful Degradation]
    
    E --> E1[Log Error]
    E --> E2[Return Fallback Value]
    E --> E3[Continue Operation]
    
    F[Chain Failure] --> G[Skip Failed Chain]
    G --> H[Continue with Other Chains]
    
    I[RPC Timeout] --> J[Implement Circuit Breaker]
    J --> K[Use Cached Data]
    
    style A fill:#e1f5fe
    style C fill:#c8e6c9
    style E fill:#fff3e0
    style H fill:#e8f5e8
```

### 10. Performance Optimization Flow

```mermaid
graph TD
    A[Data Fetch Request] --> B[Batch Operations]
    B --> C[Concurrent Processing]
    
    B --> B1[Group Similar Operations]
    B1 --> B2[Optimize Batch Sizes]
    B2 --> B3[Reduce RPC Calls]
    
    C --> C1[Process Multiple Chains]
    C --> C2[Process Multiple Pools]
    C --> C3[Process Multiple Positions]
    
    D[Rate Limiting] --> E[Batch Delays]
    E --> F[Connection Pooling]
    
    G[Caching Strategy] --> H[Hotkey-to-UID Cache]
    G --> I[EMA Weight Persistence]
    G --> J[Pool Data Cache]
    
    K[Memory Management] --> L[Stream Processing]
    L --> M[Garbage Collection]
    
    style A fill:#e1f5fe
    style B fill:#fff3e0
    style C fill:#fff3e0
    style D fill:#e8f5e8
    style G fill:#e8f5e8
    style K fill:#e8f5e8
```

## Diagram Summary

The architecture diagrams above provide a comprehensive visual representation of the BitTensor Subnet 106 Validator system:

1. **Complete Emission Calculation Flow** - Shows the end-to-end process from data collection to weight submission
2. **Subnet Weighting System** - Illustrates how alpha token prices determine subnet weights
3. **Pool Weight Distribution** - Demonstrates equal weight distribution within subnets
4. **NFT Position Scoring Algorithm** - Shows the factors that determine individual NFT scores
5. **Pool-Wise Emission Distribution** - Illustrates how rewards are distributed within pools
6. **Multi-Chain Data Flow** - Shows how data is aggregated from multiple blockchain networks
7. **EMA Weight Smoothing** - Demonstrates the exponential moving average calculation
8. **Distribution Policy Enforcement** - Shows the logic for in-range vs out-of-range miners
9. **Error Handling and Resilience** - Illustrates the system's fault tolerance mechanisms
10. **Performance Optimization Flow** - Shows the various optimization strategies employed


## NFT Position Scoring Algorithm

The validator uses a sophisticated scoring algorithm that considers multiple factors:

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

**Scoring Factors:**
1. **Range Check**: Only in-range positions (currentTick within [tickLower, tickUpper]) get non-zero scores
2. **Position Width**: Narrower ranges (more concentrated) get higher scores
3. **Distance from Current Tick**: Positions closer to current tick get higher scores
4. **Liquidity**: Higher liquidity positions get proportionally higher scores

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

**Distribution Logic:**
1. Each pool receives its allocated weight portion of the total reward
2. NFTs within each pool compete for that pool's reward allocation
3. This ensures fair competition within pools while respecting subnet-level performance

## Multi-Chain Integration

### Supported Chains

1. **Solana (Raydium CLMM)**
   - Fetches NFT positions from stake records
   - Retrieves current tick data from CLMM PoolState accounts
   - Supports subnet_id integration

2. **Coming Soon - Ethereum (Uniswap V3)**
   - Fetches NFT positions via multicall
   - Retrieves current tick data from slot0() function
   - Supports subnet_id integration

3. **Coming Soon - Base (Uniswap V3)**
   - Similar to Ethereum implementation
   - Optimized for Base network characteristics

### Chain Filtering

The validator supports configurable chain filtering via environment variables:

```typescript
// config/environment.ts
ENABLED_CHAINS: process.env.ENABLED_CHAINS || 'SOLANA,ETHEREUM,BASE'

// validator/chains/index.ts
export function getEnabledChains(): SupportedChain[] {
  return CONFIG.ENABLED_CHAINS
    .split(',')
    .map(chain => chain.trim().toLowerCase() as SupportedChain)
    .filter(chain => ['solana', 'ethereum', 'base'].includes(chain));
}
```

**Benefits:**
- Run validator on specific chains only
- Reduce RPC costs and processing time
- Test individual chain integrations
- Gradual rollout of new chains

## Data Flow

### 1. Initialization Phase
```
Validator Start → Load Configuration → Enable Chain Filtering → Log Enabled Chains
```

### 2. Data Collection Phase
```
Fetch Hotkey-to-UID Map → Get NFT Positions → Fetch Current Ticks → Get Subnet Alpha Prices
```

### 3. Weight Calculation Phase
```
Calculate Subnet Weights → Calculate Pool Weights → Calculate NFT Emissions → Aggregate Miner Weights
```

### 4. Weight Submission Phase
```
Apply EMA (if enabled) → Enforce Distribution Policy → Submit to Subtensor Chain → Save Weight History
```

## Key Algorithms

### Exponential Moving Average (EMA)

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

**Purpose:**
- Smooth weight changes over time
- Prevent sudden weight fluctuations
- Provide stability in reward distribution

### Distribution Policy Enforcement

```typescript
// Policy: If at least one miner has positive emission, submit weights for that miner only
const hasPositiveEmission = Object.values(minerWeightsRaw).some(v => isFinite(v) && v > 0);

if (hasPositiveEmission) {
  // Initialize all known UIDs to 0
  for (const hotkey of Object.keys(hotkeyToUid)) {
    minerWeights[hotkey] = 0;
  }
  
  // Assign weights only to miners with positive emissions
  for (const [hotkey, w] of Object.entries(minerWeightsRaw)) {
    if (isFinite(w) && w > 0) {
      minerWeights[hotkey] = w;
    }
  }
} else {
  // All out-of-range: fallback to uniform distribution
  logger.info('All staked NFTs are out-of-range. Submitting uniform weights across all UIDs.');
}
```

**Policy Rules:**
1. **In-Range Miners**: Only miners with positive emissions receive weights
2. **Out-of-Range Miners**: All miners get 0 weight if no one is in-range
3. **Fallback**: Uniform distribution if all emissions are zero

## Configuration

### Environment Variables

```typescript
// Chain Configuration
ENABLED_CHAINS: 'SOLANA,ETHEREUM,BASE'

// Subtensor Configuration
SUBTENSOR: {
  WS_URL: 'wss://...',
  HOTKEY_URI: '...', // Can be private key, URI, or mnemonic
  NETUID: 106
}

// Validator Configuration
VALIDATOR: {
  USE_EMA: true,
  EMA_ALPHA: 0.3,
  EMA_EPSILON: 0.001,
  INTERVAL_MINUTES: 5
}

// Performance Configuration
PERFORMANCE: {
  MAX_RETRIES: 3,
  RPC_TIMEOUT_MS: 30000,
  BATCH_DELAY_MS: 100
}
```

### Chain-Specific Configuration

```typescript
// Solana
SOLANA: {
  RPC_ENDPOINT: 'https://...',
  PROGRAM_ID: '94eEgDGUACUpxb9urozawngF7CuZ6A7zjVyFC8QK9fDb',
  CLMM_PROGRAM_ID: 'DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH'
}

// Ethereum
ETHEREUM: {
  RPC_ENDPOINT: 'https://...',
  SN106_CONTRACT_ADDRESS: '0x...',
  UNISWAP_V3_FACTORY_ADDRESS: '0x...',
  UNISWAP_V3_POSITION_MANAGER_ADDRESS: '0x...'
}
```

## Performance Optimizations

### 1. Multicall Integration
- Batch multiple RPC calls into single transactions
- Reduce network overhead and latency
- Optimized batch sizes for different operation types

### 2. Connection Pooling
- Reuse RPC connections where possible
- Implement connection timeouts and retries
- Graceful fallback mechanisms

### 3. Batch Processing
- Process NFT positions in configurable batches
- Concurrent processing with rate limiting
- Memory-efficient data structures

### 4. Caching Strategies
- Cache hotkey-to-UID mappings
- Store EMA weights between runs
- Optimize repeated calculations

## Error Handling & Resilience

### 1. Graceful Degradation
- Continue operation if individual chains fail
- Fallback to uniform weight distribution
- Log errors without stopping execution

### 2. Retry Mechanisms
- Exponential backoff for failed operations
- Configurable retry limits and delays
- Circuit breaker patterns for persistent failures

### 3. Data Validation
- Validate all incoming data structures
- Check for reasonable value ranges
- Handle malformed responses gracefully

## Monitoring & Logging

### Log Levels
- **INFO**: Normal operation events
- **WARN**: Non-critical issues
- **ERROR**: Critical failures
- **DEBUG**: Detailed debugging information

### Key Metrics
- NFT position counts per chain
- Pool weights and subnet distributions
- Emission calculation times
- Weight submission success rates

### Weight History
- All weight submissions are logged to `weights/weights_history.json`
- Includes timestamps, transaction hashes, and version keys
- Enables audit trail and historical analysis


