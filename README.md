# Subnet 106

## Overview

**SN106** is a specialized Bittensor subnet that rewards miners for providing concentrated liquidity to wAlpha/wTAO trading pairs on Solana. This subnet creates a bridge between Bittensor's alpha token ecosystem and Solana's DeFi infrastructure, enabling cross-chain liquidity provision and fee generation.

## How It Works

SN106 operates on a **two-tier reward system**:
1. **Subnet Performance**: Rewards distributed based on subnet alpha token prices
2. **Individual Performance**: NFT liquidity positions compete within pools based on concentration and market proximity

Miners provide liquidity to Raydium CLMM pools, stake their position NFTs, and earn emissions based on the quality of their position and the performance of their chosen subnet.

## Documentation

For detailed technical information, refer to our comprehensive documentation:
- **[Architecture Guide](docs/ARCHITECTURE.md)** - System design, data flows, and technical architecture
- **[Quick Reference](docs/QUICK_REFERENCE.md)** - Fast lookup for common operations and configurations
- **[Technical Implementation](docs/TECHNICAL_IMPLEMENTATION.md)** - Code examples, algorithms, and implementation details

## For Miners

### Step 1: Bridge Your Tokens
1. Visit [VoidAI Bridge](https://www.bridge.voidai.com)
2. Bridge your **alpha tokens** from different Bittensor subnets to Solana
3. Bridge **TAO** from Bittensor to Solana
4. You'll receive **wAlpha** and **wTAO** tokens on Solana

**Resources**: [VoidAI Bridge](https://www.bridge.voidai.com) - Cross-chain bridge for Bittensor tokens

### Step 2: Provide Concentrated Liquidity
1. Go to [Raydium](https://raydium.io) on Solana
2. Navigate to Concentrated Liquidity (CLMM)
3. Select **wAlpha/wTAO** pairs for different subnet tokens
4. Choose your liquidity range (narrower ranges = higher potential rewards)
5. Provide liquidity and receive a **position NFT**

### Step 3: Stake Your Position
1. Stake your **liquidity position NFT** to the SN106 smart contract on Solana
2. Your position will start earning **emissions** based on:
   - Position concentration (narrower ranges score higher)
   - Proximity to current market price
   - Liquidity amount
   - Subnet performance

### Step 4: Earn Rewards
- **Emissions**: Earn SN106 based on position quality and subnet performance
- **Trading Fees**: While liquidity position NFT is staked, trading fees from your position go to the SN106 treasury

## For Validators

### System Requirements

#### Minimum Specifications
- **CPU**: 4 cores 
- **RAM**: 8GB RAM
- **Storage**: 50GB+ SSD storage
- **Network**: Stable internet connection (50+ Mbps)
- **OS**: Linux (Ubuntu 20.04+ recommended), macOS, or Windows

#### Recommended Specifications
- **CPU**: 8 cores 
- **RAM**: 16GB RAM
- **Storage**: 100GB+  SSD
- **Network**: High-speed internet (100+ Mbps)
- **OS**: Linux (Ubuntu 22.04 LTS)

### Dependencies

#### Required Software
- **Node.js**: v18.0.0 or higher
- **npm**: v8.0.0 or higher
- **Git**: Latest version

#### Blockchain Access
- **Solana RPC**: Access to Solana mainnet/devnet
- **Ethereum RPC**: Access to Ethereum mainnet (coming soon)
- **Base RPC**: Access to Base network (coming soon)
- **Subtensor**: Access to Bittensor network RPC

### Installation & Setup

#### 1. Clone the Repository
```bash
git clone <repository-url>
cd sn106
```

#### 2. Install Dependencies
```bash
npm install
```

#### 3. Configure Environment
```bash
# Copy environment template
cp .env.example .env

# Edit environment variables
nano .env
```

#### 4. Required Environment Variables
```bash
# Subtensor Configuration
SUBTENSOR_WS_URL=wss://your-subtensor-endpoint
VALIDATOR_HOTKEY_MNEMONIC=your-hotkey-mnemonic
NETUID=106

# Solana Configuration
SOLANA_RPC_ENDPOINT=https://your-solana-rpc
SN106_SVM_PROGRAM_ID=your-program-id
RAYDIUM_CLMM_PROGRAM_ID=your-clmm-program-id

# Coming Soon: Ethereum/Base Configuration
# ETHEREUM_RPC_URL=https://your-ethereum-rpc
# BASE_RPC_URL=https://your-base-rpc
```

#### 5. Run the Validator
```bash
# Start the validator
npm run validator

```

### What the Validator Does

1. **Data Collection**: Fetches NFT liquidity positions from enabled chains
2. **Performance Analysis**: Calculates current tick data and position quality
3. **Weight Calculation**: Determines miner weights based on position quality and subnet performance
4. **Weight Submission**: Submits calculated weights to the BitTensor network every 20 minutes

### Monitoring & Maintenance

- **Logs**: Monitor validator logs for operation status
- **Weight History**: All submissions saved to `weights/weights_history.json`
- **Health Checks**: Automatic connection monitoring and reconnection
- **Performance**: Optimized batch processing and multicall operations

## Supported Networks

- **Primary**: Solana (Raydium CLMM)
- **Coming Soon**: Ethereum (Uniswap V3)
- **Coming Soon**: Base (Uniswap V3)

## Key Features

- **Multi-Chain Support**: Aggregate data from multiple blockchain networks
- **Intelligent Scoring**: Advanced algorithm for NFT position evaluation
- **Performance-Based Rewards**: Rewards tied to subnet and individual performance
- **Automatic Operation**: Runs continuously with configurable intervals
- **Comprehensive Logging**: Detailed operation logs and weight history
- **Error Resilience**: Graceful handling of network issues and failures

## Getting Help

- **Documentation**: Check the `docs/` folder for detailed technical information
  - [Architecture Documentation](docs/ARCHITECTURE.md) - Comprehensive system overview and design
  - [Quick Reference Guide](docs/QUICK_REFERENCE.md) - Fast lookup for common operations
  - [Technical Implementation](docs/TECHNICAL_IMPLEMENTATION.md) - Detailed code examples and patterns
- **Issues**: Report bugs or problems through the project's issue tracker
- **Community**: Join the Bittensor community for support and discussions

## License

This project is licensed under the terms specified in the LICENSE file.

---

**Note**: This validator is designed for production use and includes comprehensive error handling, performance optimizations, and monitoring capabilities. Ensure you have proper backup and monitoring systems in place before running in production environments.
