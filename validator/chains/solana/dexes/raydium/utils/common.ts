import { Connection } from "@solana/web3.js";
import { logger } from "../../../../../../utils/logger";
import { CONFIG } from "../../../../../../config/environment";

/**
 * Split an array into chunks of specified size
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
    array.slice(i * size, i * size + size)
  );
}

/**
 * Create a promise that resolves after specified milliseconds
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Robust retry mechanism with exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = CONFIG.PERFORMANCE.MAX_RETRIES,
  context: string = 'operation'
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxRetries) {
        logger.error(`❌ ${context} failed after ${maxRetries} attempts:`, error);
        break;
      }
      
      const delayMs = CONFIG.PERFORMANCE.RETRY_BASE_DELAY_MS * Math.pow(1.5, attempt - 1);
      logger.info(`⚠️ ${context} attempt ${attempt}/${maxRetries} failed, retrying in ${delayMs}ms`);
      await delay(delayMs);
    }
  }
  
  throw lastError!;
}

/**
 * Create a Solana connection with proper configuration
 */
export function createConnection(): Connection {
  return new Connection(CONFIG.SOLANA.RPC_ENDPOINT, {
    commitment: "confirmed",
    wsEndpoint: undefined, // Avoid websocket issues
  });
} 