import Web3 from 'web3';
import { MultiCallService, Web3ProviderConnector } from '@1inch/multicall';
import { logger } from '../../../../utils/logger';
import { CONFIG } from '../../../../config/environment';
import {
  SN106_CONTRACT_ABI,
  POSITION_MANAGER_ABI,
  POOL_ABI,
  FACTORY_ABI,
} from '../../../abis/index.js';

// Re-export ABIs for backward compatibility
export { SN106_CONTRACT_ABI, POSITION_MANAGER_ABI, POOL_ABI, FACTORY_ABI };

/**
 * Multicall utility for Ethereum chain operations
 * Provides efficient batch RPC calls to reduce network requests
 */

/**
 * Multicall service instance with rate limit handling
 */
class EthereumMulticall {
  private web3Provider: Web3;
  private ethMulticall: Web3ProviderConnector;
  private multiCallService: MultiCallService;
  private lastCallTime: number = 0;
  private minCallInterval: number = 100; // Minimum 100ms between calls

  constructor() {
    const rpcUrl = CONFIG.ETHEREUM.RPC_URL;
    if (!rpcUrl) {
      throw new Error('Ethereum Sepolia RPC URL not configured');
    }

    this.web3Provider = new Web3(rpcUrl);
    this.ethMulticall = new Web3ProviderConnector(this.web3Provider);
    this.multiCallService = new MultiCallService(
      this.ethMulticall,
      CONFIG.ETHEREUM.MULTICALL_ADDRESS,
    );
  }

  /**
   * Delay to respect rate limits
   */
  private async respectRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCallTime;
    
    if (timeSinceLastCall < this.minCallInterval) {
      const delay = this.minCallInterval - timeSinceLastCall;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    this.lastCallTime = Date.now();
  }

  /**
   * Execute multicall batch with retry logic and rate limiting
   */
  async executeBatch(
    calls: Array<{ to: string; data: string }>,
    params = {
      chunkSize: 100,
      retriesLimit: 3,
      blockNumber: 'latest',
    },
  ) {
    const maxRetries = params.retriesLimit || 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Respect rate limits
        await this.respectRateLimit();

        const result = await this.multiCallService.callByChunks(calls, params);
        return result;
      } catch (error: any) {
        lastError = error;
        const errorMessage = error?.message || String(error);

        // Check if it's a rate limit error
        const isRateLimitError =
          errorMessage.includes('429') ||
          errorMessage.includes('rate limit') ||
          errorMessage.includes('too many requests');

        if (isRateLimitError) {
          // Exponential backoff for rate limits (longer delays)
          const baseDelay = 2000; // 2 seconds base for rate limits
          const delay = baseDelay * Math.pow(2, attempt - 1);
          logger.warn(
            `⚠️ Rate limit hit on attempt ${attempt}/${maxRetries}, retrying in ${delay}ms...`,
          );
          await new Promise(resolve => setTimeout(resolve, delay));
        } else if (attempt < maxRetries) {
          // Regular retry with shorter delay
          const delay = 500 * attempt;
          logger.warn(
            `⚠️ Multicall attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms...`,
          );
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // Last attempt failed
          logger.error(
            `❌ Multicall failed after ${maxRetries} attempts:`,
            error,
          );
        }
      }
    }

    throw lastError || new Error('Multicall failed after all retries');
  }

  /**
   * Encode contract call data
   */
  encodeCall(
    abi: any[],
    contractAddress: string,
    functionName: string,
    params: any[],
  ) {
    return this.ethMulticall.contractEncodeABI(
      abi,
      contractAddress,
      functionName,
      params,
    );
  }

  /**
   * Decode result data
   */
  decodeResult(types: string[], data: string) {
    return this.web3Provider.eth.abi.decodeParameters(types, data);
  }

  /**
   * Get Web3 provider instance
   */
  getWeb3Provider() {
    return this.web3Provider;
  }
}

// Singleton instance
let multicallInstance: EthereumMulticall | null = null;

export function getMulticallInstance(): EthereumMulticall {
  if (!multicallInstance) {
    multicallInstance = new EthereumMulticall();
  }
  return multicallInstance;
}

/**
 * Multicall parameters for batch operations
 */
export const DEFAULT_MULTICALL_PARAMS = {
  chunkSize: 100,
  retriesLimit: 3,
  blockNumber: 'latest' as const,
};

// Dynamic chunk sizing based on operation type
export const OPTIMIZED_MULTICALL_PARAMS = {
  HOTKEY_BATCH: {
    chunkSize: 250,
    retriesLimit: 3,
    blockNumber: 'latest' as const,
  },
  POSITION_BATCH: {
    chunkSize: 300,
    retriesLimit: 3,
    blockNumber: 'latest' as const,
  },
  POOL_BATCH: {
    chunkSize: 120,
    retriesLimit: 3,
    blockNumber: 'latest' as const,
  },
  TICK_BATCH: {
    chunkSize: 120,
    retriesLimit: 3,
    blockNumber: 'latest' as const,
  },
};

/**
 * Helper function to create contract call data
 */
export interface ContractCall {
  to: string;
  data: string;
  context?: any; // Additional context for processing results
}

export function createContractCall(
  contractAddress: string,
  abi: any[],
  functionName: string,
  params: any[],
  context?: any,
): ContractCall {
  const multicall = getMulticallInstance();
  return {
    to: contractAddress,
    data: multicall.encodeCall(abi, contractAddress, functionName, params),
    context,
  };
}
