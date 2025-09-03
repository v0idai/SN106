# Multi-Chain Multi-DEX Architecture

This directory contains the validator logic organized by blockchain chains, with each chain supporting multiple DEXes.

## Structure

```
validator/chains/
├── solana/
│   ├── index.ts                    # Chain-level aggregator
│   └── dexes/
│       └── raydium/               # Raydium DEX implementation
│           ├── positions.ts        # NFT position fetching
│           ├── ticks.ts            # Pool tick data
│           ├── types.ts            # Type definitions
│           └── utils/              # Helper functions
├── ethereum (Coming Soon)
│   
├── base (Coming Soon)
│  
└── index.ts                        # Multi-chain aggregator
```

## Design Principles

1. **Chain-Level Organization**: Each blockchain has its own directory
2. **DEX-Level Implementation**: Each DEX has its own subdirectory under the chain
3. **Aggregation Pattern**: Chain-level index files aggregate data from all DEXes
4. **Extensibility**: Easy to add new DEXes to existing chains or new chains entirely


## Current DEX Support

- **Solana**: Raydium (CLMM)
- **Ethereum**: Uniswap V3 (planned)
- **Base**: Uniswap V3 (planned)

## Interface Requirements

Each DEX implementation must provide:

- `getAllNFTPositions(hotkeys: string[]): Promise<NFTPosition[]>`
- `getCurrentTickPerPool(): Promise<Record<string, number>>`

## Benefits

- **Modularity**: Each DEX is self-contained
- **Maintainability**: Easy to update individual DEX implementations
- **Scalability**: Simple to add new chains and DEXes
- **Testing**: Can test DEX implementations independently
- **Deployment**: Can deploy updates to specific DEXes without affecting others
