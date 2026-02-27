# Ethereum Chain Integration

This directory contains the Ethereum chain integration for the SN106 validator, specifically designed to work with Uniswap V3 on Sepolia testnet.

## Overview

The Ethereum integration fetches NFT positions and current pool ticks from the deployed SN106 contract and Uniswap V3 contracts using efficient multicall batching to minimize RPC calls.

## Architecture

```
ethereum/
├── dexes/
│   └── uniswap-v3/
│       ├── positions.ts    # Fetches staked NFT positions
│       └── ticks.ts        # Fetches current pool ticks
├── utils/
│   └── multicall.ts        # Multicall utilities and ABIs
├── index.ts                # Main Ethereum chain aggregator
└── README.md               # This file
```

## Features

- **Multicall Integration**: Uses `@1inch/multicall` for efficient batch RPC calls
- **Position Fetching**: Retrieves all staked Uniswap V3 positions for given hotkeys
- **Tick Data**: Fetches current tick data from all supported pools
- **Error Handling**: Robust error handling with detailed logging
- **Type Safety**: Full TypeScript integration with the existing validator structure

## Configuration

The integration requires the following environment variables:

```env
# Sepolia RPC endpoint
ETHEREUM_SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY

# Contract addresses
SN106_CONTRACT_ADDRESS=0x...                                    # Your deployed SN106 contract
UNISWAP_V3_FACTORY_ADDRESS=0x1F98431c8aD98523631AE4a59f267346ea31F984
UNISWAP_V3_POSITION_MANAGER_ADDRESS=0x1238536071E1c677A632429e3655c799b22cDA52
SEPOLIA_MULTICALL_ADDRESS=0x642125ae88cfDa014474E4A82E63F848B352672d
```

## Contract Requirements

The SN106 contract must implement the following functions for the integration to work:

```solidity
// Get staked token IDs for a hotkey (compatible with reference NFTStaking.sol)
function getStakedTokens(string calldata hotkey) 
    external view returns (uint256[] memory)

// Get all supported pool addresses
function getAllPools() external view returns (address[] memory)

// Original function - returns both token IDs and pool addresses
function getStakesByHotkey(string calldata hotkey) 
    external view returns (uint256[] memory tokenIds, address[] memory poolAddrs)
```

## Data Flow

1. **Position Fetching** (`positions.ts`):
   - Batch call `getStakedTokens()` for all hotkeys
   - Batch call `positions()` on Uniswap V3 Position Manager for all token IDs
   - Resolve pool addresses using Uniswap V3 Factory
   - Return structured `NFTPosition[]` data

2. **Tick Fetching** (`ticks.ts`):
   - Call `getAllPools()` to get supported pool addresses
   - Batch call `slot0()` on all pool contracts
   - Extract current tick from slot0 data
   - Return `Record<string, number>` mapping pool address to tick

## Usage

```typescript
import { getAllNFTPositions } from './dexes/uniswap-v3/positions';
import { getCurrentTickPerPool } from './dexes/uniswap-v3/ticks';

// Fetch positions for hotkeys
const positions = await getAllNFTPositions(['hotkey1', 'hotkey2']);

// Fetch current ticks for all pools
const ticks = await getCurrentTickPerPool();

// The data is compatible with the existing emissions calculation
```

## Testing

Run the integration test:

```bash
npm run test:ethereum
```

This will test:
- Position fetching for configured hotkeys
- Tick data retrieval from all pools
- Data matching and in-range validation

## Integration with Reference Files

This implementation is designed to be compatible with the reference files:

- **`evm-sample/twoMultiPosition.js`**: Similar multicall approach but integrated into the validator structure
- **`evm-sample/NFTStaking.sol`**: Compatible interface through `getStakedTokens()` function
- **`contracts/sn106.sol`**: Enhanced with additional functions for better integration

## Performance Optimizations

- **Multicall Batching**: Reduces RPC calls by ~90% compared to individual calls
- **Efficient Decoding**: Direct ABI decoding without intermediate parsing
- **Error Isolation**: Failed calls don't break the entire batch
- **Configurable Chunks**: Adjustable batch sizes for different network conditions

## Error Handling

The integration includes comprehensive error handling:

- Network failures are logged but don't crash the validator
- Individual position/tick failures are isolated
- Fallback to empty results when contracts are not configured
- Detailed logging for debugging

## Monitoring

Key metrics logged:
- Number of hotkeys processed
- Number of positions found
- Number of pools with tick data
- Processing time for each operation
- Success/failure rates

## Future Enhancements

- Support for additional Ethereum networks (mainnet, other testnets)
- Integration with other DEXes (Balancer, Curve, etc.)
- Caching layer for frequently accessed data
- WebSocket support for real-time tick updates
