import * as dotenv from 'dotenv';
import { PublicKey } from '@solana/web3.js';
import { clusterApiUrl } from '@solana/web3.js';

// Load environment variables once at the top level
dotenv.config();

/**
 * Centralized environment configuration
 * All environment variables should be accessed through this file
 */
export const ENV = {
  // Validator Configuration
  VALIDATOR_INTERVAL_MINUTES: process.env.VALIDATOR_INTERVAL_MINUTES || 20,
  USE_EMA: (process.env.USE_EMA ?? 'true').toLowerCase() !== 'false',
  EMA_ALPHA: Number(process.env.EMA_ALPHA) || 0.3,
  EMA_EPSILON: Number(process.env.EMA_EPSILON) || 1e-6,

  // Chain Configuration
  ENABLED_CHAINS: process.env.ENABLED_CHAINS || 'SOLANA,ETHEREUM,BASE',

  // Hotkeys
  MINER_HOTKEYS: process.env.MINER_HOTKEYS || '',

  // Solana Configuration
  SOLANA_RPC_ENDPOINT: process.env.SOLANA_RPC_ENDPOINT || clusterApiUrl("devnet"),
  SN106_SVM_PROGRAM_ID: process.env.SN106_SVM_PROGRAM_ID || "DtZgqA3dvVK1m1CUEnkipEHyDtPzAmxb98SU9sqYDpDE",
  RAYDIUM_CLMM_PROGRAM_ID: process.env.RAYDIUM_CLMM_PROGRAM_ID || "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH",

  // Ethereum Configuration
  ETHEREUM_RPC_URL: process.env.ETHEREUM_RPC_URL || '',
  SN106_CONTRACT_ADDRESS: process.env.ETH_SN106_CONTRACT_ADDRESS || '',
  UNISWAP_V3_FACTORY_ADDRESS: process.env.UNISWAP_V3_FACTORY_ADDRESS || '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  UNISWAP_V3_POSITION_MANAGER_ADDRESS: process.env.UNISWAP_V3_POSITION_MANAGER_ADDRESS || '0x1238536071E1c677A632429e3655c799b22cDA52',
  ETH_MULTICALL_ADDRESS: process.env.ETH_MULTICALL_ADDRESS || '0x642125ae88cfDa014474E4A82E63F848B352672d',

  // Base Configuration
  BASE_RPC_URL: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
  BASE_SN106_CONTRACT_ADDRESS: process.env.BASE_SN106_CONTRACT_ADDRESS || '',
  BASE_UNISWAP_V3_FACTORY_ADDRESS: process.env.BASE_UNISWAP_V3_FACTORY_ADDRESS || '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  BASE_UNISWAP_V3_POSITION_MANAGER_ADDRESS: process.env.BASE_UNISWAP_V3_POSITION_MANAGER_ADDRESS || '0x03a520b32C04BF3bEEf7BF5d56E3f7f3Ac0c7c47',
  BASE_MULTICALL_ADDRESS: process.env.BASE_MULTICALL_ADDRESS || '0xcA11bde05977b3631167028862bE2a173976CA11',

  // Subtensor Configuration
  SUBTENSOR_WS_URL: process.env.SUBTENSOR_WS_URL || 'ws://localhost:9944',
  VALIDATOR_HOTKEY_MNEMONIC: process.env.VALIDATOR_HOTKEY_MNEMONIC || '',
  NETUID: Number(process.env.NETUID) || 106,

  // Bittensor Configuration
  BITTENSOR_WS_ENDPOINT: process.env.BITTENSOR_WS_ENDPOINT || 'wss://entrypoint-finney.opentensor.ai:443',
  HOTKEYS_CACHE_TTL_MS: Number(process.env.HOTKEYS_CACHE_TTL_MS) || 5 * 60 * 1000, // 5 minutes

  // Retry and Timeout Configuration
  MAX_RETRIES: Number(process.env.MAX_RETRIES) || 3,
  RETRY_BASE_DELAY_MS: Number(process.env.RETRY_BASE_DELAY_MS) || 1000,
  INITIAL_RETRY_DELAY_MS: Number(process.env.INITIAL_RETRY_DELAY_MS) || 500,
  MAX_RETRY_DELAY_MS: Number(process.env.MAX_RETRY_DELAY_MS) || 5000,
  RPC_TIMEOUT_MS: Number(process.env.RPC_TIMEOUT_MS) || 30000,

  // Batch Configuration
  POSITION_BATCH_SIZE: Number(process.env.POSITION_BATCH_SIZE) || 100,
  MAX_CONCURRENT_BATCHES: Number(process.env.MAX_CONCURRENT_BATCHES) || 3,
  BATCH_DELAY_MS: Number(process.env.BATCH_DELAY_MS) || 50,
  HOTKEY_BATCH_SIZE: Number(process.env.HOTKEY_BATCH_SIZE) || 8,
} as const;

// Supported chain types
export type SupportedChain = 'solana';

/**
 * Validated configuration with computed values
 */
export const CONFIG = {
  // Validator
  VALIDATOR_INTERVAL_MINUTES: ENV.VALIDATOR_INTERVAL_MINUTES,
  VALIDATOR: {
    USE_EMA: ENV.USE_EMA,
    EMA_ALPHA: ENV.EMA_ALPHA,
    EMA_EPSILON: ENV.EMA_EPSILON,
  },

  // Chain Configuration
  getEnabledChains(): SupportedChain[] {
    const chainsEnv = ENV.ENABLED_CHAINS.toUpperCase();
    const allChains: SupportedChain[] = ['solana'];

    return allChains;
  },

  isChainEnabled(chain: SupportedChain): boolean {
    return this.getEnabledChains().includes(chain);
  },


  // Solana
  SOLANA: {
    RPC_ENDPOINT: ENV.SOLANA_RPC_ENDPOINT,
    PROGRAM_ID: new PublicKey(ENV.SN106_SVM_PROGRAM_ID),
    CLMM_PROGRAM_ID: new PublicKey(ENV.RAYDIUM_CLMM_PROGRAM_ID),
  },

  // Ethereum
  ETHEREUM: {
    RPC_URL: ENV.ETHEREUM_RPC_URL,
    SN106_CONTRACT_ADDRESS: ENV.SN106_CONTRACT_ADDRESS,
    UNISWAP_V3_FACTORY_ADDRESS: ENV.UNISWAP_V3_FACTORY_ADDRESS,
    UNISWAP_V3_POSITION_MANAGER_ADDRESS: ENV.UNISWAP_V3_POSITION_MANAGER_ADDRESS,
    MULTICALL_ADDRESS: ENV.ETH_MULTICALL_ADDRESS,
  },

  // Base
  BASE: {
    RPC_URL: ENV.BASE_RPC_URL,
    SN106_CONTRACT_ADDRESS: ENV.BASE_SN106_CONTRACT_ADDRESS,
    UNISWAP_V3_FACTORY_ADDRESS: ENV.BASE_UNISWAP_V3_FACTORY_ADDRESS,
    UNISWAP_V3_POSITION_MANAGER_ADDRESS: ENV.BASE_UNISWAP_V3_POSITION_MANAGER_ADDRESS,
    MULTICALL_ADDRESS: ENV.BASE_MULTICALL_ADDRESS,
  },

  // Subtensor
  SUBTENSOR: {
    WS_URL: ENV.SUBTENSOR_WS_URL,
    HOTKEY_MNEMONIC: ENV.VALIDATOR_HOTKEY_MNEMONIC,
    NETUID: ENV.NETUID,
  },

  // Bittensor
  BITTENSOR: {
    WS_ENDPOINT: ENV.BITTENSOR_WS_ENDPOINT,
    HOTKEYS_CACHE_TTL_MS: ENV.HOTKEYS_CACHE_TTL_MS,
  },

  // Performance
  PERFORMANCE: {
    MAX_RETRIES: ENV.MAX_RETRIES,
    RETRY_BASE_DELAY_MS: ENV.RETRY_BASE_DELAY_MS,
    INITIAL_RETRY_DELAY_MS: ENV.INITIAL_RETRY_DELAY_MS,
    MAX_RETRY_DELAY_MS: ENV.MAX_RETRY_DELAY_MS,
    RPC_TIMEOUT_MS: ENV.RPC_TIMEOUT_MS,
    POSITION_BATCH_SIZE: ENV.POSITION_BATCH_SIZE,
    MAX_CONCURRENT_BATCHES: ENV.MAX_CONCURRENT_BATCHES,
    BATCH_DELAY_MS: ENV.BATCH_DELAY_MS,
    HOTKEY_BATCH_SIZE: ENV.HOTKEY_BATCH_SIZE,
  },
} as const;

/**
 * Environment validation
 */
export function validateEnvironment(): void {
  const required = [
    'SOLANA_RPC_ENDPOINT',
    'SN106_SVM_PROGRAM_ID',
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.warn(`⚠️ Missing environment variables: ${missing.join(', ')}`);
    console.warn('Using default values for missing variables');
  }
}

// Validate environment on import
validateEnvironment(); 