import { ApiPromise, WsProvider } from '@polkadot/api';
import { logger } from '../../utils/logger';

/**
 * Singleton Subtensor API Client
 * Manages a single API connection to avoid multiple initializations
 */
export class SubtensorAPIClient {
  private static instance: SubtensorAPIClient;
  private api: ApiPromise | null = null;
  private provider: WsProvider | null = null;
  private wsUrl: string | null = null;
  private isInitialized = false;
  private isConnecting = false;
  private connectionPromise: Promise<void> | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // 1 second

  private constructor() {}

  public static getInstance(): SubtensorAPIClient {
    if (!SubtensorAPIClient.instance) {
      SubtensorAPIClient.instance = new SubtensorAPIClient();
    }
    return SubtensorAPIClient.instance;
  }

  /**
   * Initialize the API client with a WebSocket URL
   */
  public async initialize(wsUrl: string): Promise<void> {
    // If already initialized with the same URL, return
    if (this.isInitialized && this.wsUrl === wsUrl) {
      return;
    }

    // If already connecting, wait for that connection
    if (this.isConnecting && this.connectionPromise) {
      await this.connectionPromise;
      return;
    }

    // If we have a different URL, disconnect the old connection
    if (this.api && this.wsUrl !== wsUrl) {
      await this.disconnect();
    }

    // Start new connection
    this.isConnecting = true;
    this.connectionPromise = this._connect(wsUrl);
    
    try {
      await this.connectionPromise;
      this.isConnecting = false;
      this.connectionPromise = null;
      this.startHealthCheck();
    } catch (error) {
      this.isConnecting = false;
      this.connectionPromise = null;
      throw error;
    }
  }

  private async _connect(wsUrl: string): Promise<void> {
    try {
      logger.info(`🔌 Initializing Subtensor API connection to ${wsUrl}`);
      
      this.provider = new WsProvider(wsUrl);
      this.api = await ApiPromise.create({ provider: this.provider });
      this.wsUrl = wsUrl;
      this.isInitialized = true;
      this.reconnectAttempts = 0;
      
      // Set up connection event handlers
      this.provider.on('connected', () => {
        logger.info('🔌 Subtensor WebSocket provider connected');
      });
      
      this.provider.on('disconnected', () => {
        logger.warn('🔌 Subtensor WebSocket provider disconnected');
        this.isInitialized = false;
        this.scheduleReconnect();
      });
      
      this.provider.on('error', (error) => {
        logger.error('❌ Subtensor WebSocket provider error:', error);
        this.isInitialized = false;
        this.scheduleReconnect();
      });
      
      logger.info('✅ Subtensor API connection established');
    } catch (error) {
      logger.error('❌ Failed to initialize Subtensor API connection:', error);
      throw error;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error(`❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
    
    logger.info(`🔄 Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
    
    setTimeout(async () => {
      if (this.wsUrl && !this.isInitialized) {
        try {
          await this._connect(this.wsUrl);
          this.startHealthCheck();
        } catch (error) {
          logger.error('❌ Reconnection failed:', error);
          this.scheduleReconnect();
        }
      }
    }, delay);
  }

  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      if (!this.isInitialized || !this.api) {
        return;
      }

      try {
        // Simple health check - get the latest block number
        await this.api.rpc.chain.getHeader();
      } catch (error) {
        logger.warn('⚠️ API health check failed, connection may be unhealthy:', error);
        this.isInitialized = false;
        this.scheduleReconnect();
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Get the API instance
   */
  public getAPI(): ApiPromise {
    if (!this.isInitialized || !this.api) {
      throw new Error('API client not initialized. Call initialize() first.');
    }
    return this.api;
  }

  /**
   * Check if the client is initialized
   */
  public isReady(): boolean {
    return this.isInitialized && this.api !== null;
  }

  /**
   * Get the current WebSocket URL
   */
  public getWsUrl(): string | null {
    return this.wsUrl;
  }

  /**
   * Get connection status information
   */
  public getStatus(): {
    isInitialized: boolean;
    isConnecting: boolean;
    wsUrl: string | null;
    reconnectAttempts: number;
  } {
    return {
      isInitialized: this.isInitialized,
      isConnecting: this.isConnecting,
      wsUrl: this.wsUrl,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  /**
   * Disconnect the API client
   */
  public async disconnect(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.api) {
      try {
        await this.api.disconnect();
        logger.info('🔌 Subtensor API connection disconnected');
      } catch (error) {
        logger.warn('⚠️ Error during API disconnection:', error);
      }
      this.api = null;
    }
    
    if (this.provider) {
      try {
        await this.provider.disconnect();
      } catch (error) {
        logger.warn('⚠️ Error during provider disconnection:', error);
      }
      this.provider = null;
    }
    
    this.isInitialized = false;
    this.wsUrl = null;
  }

  /**
   * Gracefully shutdown the client
   */
  public async shutdown(): Promise<void> {
    await this.disconnect();
  }
}

// Export a default instance
export const subtensorClient = SubtensorAPIClient.getInstance();
