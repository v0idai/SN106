# Quick Reference Guide

## Bittensor SN106 VoidAI - Validator

### **What It Does**
The validator calculates and distributes rewards to miners based on their NFT liquidity positions across multiple blockchain networks like Solana, Ethereum (coming soon), and Base (coming soon).

### **Key Concepts**

#### **Two-Tier Weighting System**
1. **Subnet Level**: Rewards distributed based on subnet performance (alpha token prices)
2. **Pool Level**: Within each subnet, pools get equal weight distribution

#### **Alpha Token Prices**
- Higher alpha prices = Higher subnet performance = More rewards
- Weights are normalized to sum to 1.0 for fair distribution

#### **NFT Scoring Factors**
1. **Position Width**: Narrower ranges get higher scores (more concentrated)
2. **Distance from Current Tick**: Closer to current tick = higher score
3. **Liquidity**: Higher liquidity = proportionally higher score

### **How Rewards Are Calculated**

```
Step 1: Get Subnet Alpha Prices
├── Subnet 1: α1 = 1.0
├── Subnet 2: α2 = 1.02
└── Subnet 3: α3 = 0.98

Step 2: Calculate Subnet Weights
├── Total = 3.0
├── Subnet 1: 1.0/3.0 = 0.333
├── Subnet 2: 1.02/3.0 = 0.340
└── Subnet 3: 0.98/3.0 = 0.327

Step 3: Distribute to Pools (Reserved-Share Logic)
├── Reserve 0.20 equally for subnet 0 pools (no alpha tokens)
├── Reserve 0.10 equally for subnet 106 pools
├── Remaining 0.70 split across other non-zero-alpha subnets by alpha proportion
└── Within each subnet, split equally across its pools

Step 4: Calculate NFT Emissions
├── Each pool gets its allocated reward portion
├── NFTs within each pool compete for that pool's reward
└── Higher-scoring NFTs get proportionally more rewards
```

### **Data Flow**

```
1. Fetch NFT Positions → 2. Get Current Ticks → 3. Get Alpha Prices
         ↓                       ↓                    ↓
4. Calculate Subnet Weights → 5. Calculate Pool Weights → 6. Calculate NFT Emissions
         ↓                       ↓                    ↓
7. Aggregate Miner Weights → 8. Apply EMA → 9. Submit to Subtensor
```

### **Configuration**

#### **Environment Variables**
```bash
# Enable specific chains
ENABLED_CHAINS=SOLANA,...

# Validator settings
USE_EMA=true
EMA_ALPHA=0.8
INTERVAL_MINUTES=5

# Performance settings
MAX_RETRIES=3
RPC_TIMEOUT_MS=30000
```

#### **Chain-Specific Settings**
```bash
# Solana
SOLANA_RPC_ENDPOINT=https://...
SOLANA_PROGRAM_ID=94eEgDGUACUpxb9urozawngF7CuZ6A7zjVyFC8QK9fDb

# Ethereum
ETHEREUM_RPC_ENDPOINT=https://...
ETHEREUM_SN106_CONTRACT=0x...
```

### **Running the Validator**

```bash
# Install dependencies
npm install

# Run validator
npm run validator

# Run with specific chains only
ENABLED_CHAINS=SOLANA npm run validator
```

### **Monitoring & Logs**

#### **Key Log Messages**
- `🔗 Enabled chains: [solana, ethereum, base]`
- `Found X NFT positions across all chains`
- `Fetched tick data for X pools`
- `Subnet weights (based on alpha prices): {...}`
- `Pool weights (distributed from subnet weights): {...}`
- `Per-NFT emissions (pool-wise): [...]`

#### **Weight History**
- All submissions saved to `weights/weights_history.json`
- Includes timestamps, transaction hashes, and version keys

### **Error Handling**

#### **Graceful Degradation**
- Individual chain failures don't stop the entire system
- Fallback to uniform weight distribution if needed
- Comprehensive logging for debugging

#### **Retry Mechanisms**
- Exponential backoff for failed operations
- Configurable retry limits and delays
- Circuit breaker patterns for persistent failures

### **Troubleshooting**

#### **Common Issues**
1. **Pool weights are empty**: Check chain prefix matching in NFT positions
2. **RPC timeouts**: Increase `RPC_TIMEOUT_MS` or check network connectivity
3. **Chain failures**: Verify RPC endpoints and contract addresses
4. **Weight submission errors**: Check hotkey mnemonic and network connectivity

#### **Debug Mode**
```bash
# Enable debug logging
DEBUG=true npm run validator
```

### **Related Documentation**
- [Architecture Documentation](ARCHITECTURE.md) - Comprehensive system overview
- [Technical Implementation](TECHNICAL_IMPLEMENTATION.md) - Detailed code examples





