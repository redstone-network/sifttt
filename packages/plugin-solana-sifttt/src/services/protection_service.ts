import { elizaLogger, Service, type IAgentRuntime, settings } from "@elizaos/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { ProtectionAutomation } from "../actions/protection_automation";

// 服务名称常量
export const PROTECTION_SERVICE_NAME = "SIFTTT_PROTECTION_SERVICE";
export const PROTECTION_DATA_CACHE_KEY = "sifttt_protection_data";

// 保护数据接口
export interface ProtectionData {
  accountPubkey: string;
  healthFactor: number;
  triggerHealthFactor: number;
  targetHealthFactor: number;
  automationEnabled: boolean;
  lastChecked: number;
  lastTriggered?: number;
}

/**
 * Protection Service class for monitoring account health factors and auto-repaying when necessary
 * @extends Service
 */
export class ProtectionService extends Service {
  static serviceType: string = PROTECTION_SERVICE_NAME;
  capabilityDescription =
    "The agent is able to monitor health factors and automatically execute protection measures to prevent liquidation";

  private updateInterval: NodeJS.Timer | null = null;
  private lastUpdate = 0;
  private readonly UPDATE_INTERVAL = 30000; // 30 seconds
  private connection: Connection;
  private keypair: Keypair;
  private accountPubkeys: string[] = [];
  private isMonitoring = false;

  /**
   * Constructor for creating an instance of the class.
   * @param {IAgentRuntime} runtime - The runtime object that provides access to agent-specific functionality.
   */
  constructor(protected runtime: IAgentRuntime) {
    super();
    const connection = new Connection(
      runtime.getSetting("SOLANA_RPC_URL") || "https://api.devnet.solana.com"
    );
    this.connection = connection;

    // Initialize keypair
    const privateKeyString =
      runtime.getSetting("SOLANA_PRIVATE_KEY") ??
      runtime.getSetting("WALLET_PRIVATE_KEY");
    
    if (privateKeyString) {
      try {
        const secretKey = bs58.decode(privateKeyString);
        this.keypair = Keypair.fromSecretKey(secretKey);
      } catch (error) {
        elizaLogger.error("Failed to initialize keypair:", error);
      }
    }

    // Initialize account pubkeys
    const accountPubkey = runtime.getSetting("SIFTTT_ACCOUNT");
    if (accountPubkey) {
      this.accountPubkeys.push(accountPubkey);
    }
  }

  /**
   * Starts the Protection service with the given agent runtime.
   *
   * @param {IAgentRuntime} runtime - The agent runtime to use for the service.
   * @returns {Promise<ProtectionService>} The initialized Protection service.
   */
  static async start(runtime: IAgentRuntime): Promise<ProtectionService> {
    elizaLogger.log("initProtectionService");

    const protectionService = new ProtectionService(runtime);

    elizaLogger.log("ProtectionService start");
    if (protectionService.updateInterval) {
      clearInterval(protectionService.updateInterval);
    }

    // Load monitored accounts from cache
    const cachedData = await protectionService.getCachedData();
    if (cachedData && Array.isArray(cachedData)) {
      for (const data of cachedData) {
        if (data.accountPubkey && !protectionService.accountPubkeys.includes(data.accountPubkey)) {
          protectionService.accountPubkeys.push(data.accountPubkey);
        }
      }
    }

    // Set up monitoring interval
    protectionService.updateInterval = setInterval(async () => {
      elizaLogger.log("Checking health factors");
      await protectionService.checkHealthFactors();
    }, protectionService.UPDATE_INTERVAL);

    // Initial check
    protectionService.checkHealthFactors().catch(console.error);

    return protectionService;
  }

  /**
   * Stops the Protection service.
   *
   * @param {IAgentRuntime} runtime - The agent runtime.
   * @returns {Promise<void>} - A promise that resolves once the service has stopped.
   */
  static async stop(runtime: IAgentRuntime) {
    const service = runtime.getService(PROTECTION_SERVICE_NAME);
    if (!service) {
      elizaLogger.error("ProtectionService not found");
      return;
    }
    await service.stop();
  }

  /**
   * Stops the update interval if it is currently running.
   * @returns {Promise<void>} A Promise that resolves when the update interval is stopped.
   */
  async stop(): Promise<void> {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.isMonitoring = false;
  }

  /**
   * Add an account to monitor
   * @param accountPubkey - The public key of the account to monitor
   * @returns {boolean} Whether the account was successfully added
   */
  addAccountToMonitor(accountPubkey: string): boolean {
    if (!this.accountPubkeys.includes(accountPubkey)) {
      this.accountPubkeys.push(accountPubkey);
      elizaLogger.log(`Added account ${accountPubkey} to monitoring`);
      this.updateCache();
      return true;
    }
    return false;
  }

  /**
   * Remove an account from monitoring
   * @param accountPubkey - The public key of the account to stop monitoring
   * @returns {boolean} Whether the account was successfully removed
   */
  removeAccountFromMonitor(accountPubkey: string): boolean {
    const index = this.accountPubkeys.indexOf(accountPubkey);
    if (index !== -1) {
      this.accountPubkeys.splice(index, 1);
      elizaLogger.log(`Removed account ${accountPubkey} from monitoring`);
      this.updateCache();
      return true;
    }
    return false;
  }

  /**
   * Check health factors for all monitored accounts and trigger auto-repay if necessary
   * @returns {Promise<ProtectionData[]>} The latest protection data for all accounts
   */
  async checkHealthFactors(): Promise<ProtectionData[]> {
    if (!this.keypair) {
      elizaLogger.error("Keypair not initialized");
      return [];
    }

    if (this.accountPubkeys.length === 0) {
      elizaLogger.log("No accounts to monitor");
      return [];
    }

    this.isMonitoring = true;
    const now = Date.now();
    this.lastUpdate = now;
    const results: ProtectionData[] = [];

    for (const pubkeyStr of this.accountPubkeys) {
      try {
        const accountPubkey = new PublicKey(pubkeyStr);

        // Create protection automation instance
        const automation = new ProtectionAutomation(
          this.connection,
          this.keypair,
          accountPubkey
        );

        // Get current account state
        const accountState = await automation.getAccountState();
        elizaLogger.log(`Account ${pubkeyStr} - Health Factor: ${accountState.healthFactor}, Trigger: ${accountState.triggerHealthFactor}`);

        const protectionData: ProtectionData = {
          accountPubkey: pubkeyStr,
          healthFactor: accountState.healthFactor,
          triggerHealthFactor: accountState.triggerHealthFactor,
          targetHealthFactor: accountState.targetHealthFactor,
          automationEnabled: accountState.automationEnabled,
          lastChecked: now
        };

        // Check if auto-repay should be triggered
        if (
          accountState.automationEnabled &&
          accountState.healthFactor <= accountState.triggerHealthFactor &&
          accountState.triggerHealthFactor > 0
        ) {
          elizaLogger.log(`Triggering auto-repay for account ${pubkeyStr}`);
          try {
            const tx = await automation.autoRepay();
            elizaLogger.log(`Auto-repay successful: ${tx}`);
            
            // Get updated state after auto-repay
            const newState = await automation.getAccountState();
            protectionData.healthFactor = newState.healthFactor;
            protectionData.lastTriggered = now;
            
            // Event notification could be added here
            this.runtime.emit("protection:triggered", {
              accountPubkey: pubkeyStr,
              previousHealthFactor: accountState.healthFactor,
              newHealthFactor: newState.healthFactor,
              transaction: tx
            });
          } catch (error) {
            elizaLogger.error(`Auto-repay failed for account ${pubkeyStr}:`, error);
          }
        }

        results.push(protectionData);
      } catch (error) {
        elizaLogger.error(`Error checking account ${pubkeyStr}:`, error);
      }
    }

    // Update cache with latest data
    await this.updateCache(results);
    this.isMonitoring = false;
    return results;
  }

  /**
   * Update the cache with protection data
   * @param data - The protection data to cache
   */
  private async updateCache(data?: ProtectionData[]): Promise<void> {
    if (!data) {
      // If no data provided, get current data from cache
      const cachedData = await this.getCachedData();
      if (!cachedData) return;
      data = cachedData;
    }

    // Update cache
    await this.runtime.setCache<ProtectionData[]>(PROTECTION_DATA_CACHE_KEY, data);
  }

  /**
   * Get cached protection data
   * @returns {Promise<ProtectionData[] | null>} The cached protection data or null if not found
   */
  public async getCachedData(): Promise<ProtectionData[] | null> {
    const cachedValue = await this.runtime.getCache<ProtectionData[]>(PROTECTION_DATA_CACHE_KEY);
    if (cachedValue) {
      return cachedValue;
    }
    return null;
  }

  /**
   * Force check of health factors
   * @returns {Promise<ProtectionData[]>} The updated protection data
   */
  public async forceCheck(): Promise<ProtectionData[]> {
    if (this.isMonitoring) {
      elizaLogger.log("Check already in progress, waiting...");
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return await this.checkHealthFactors();
  }

  /**
   * Get the status of an account
   * @param accountPubkey - The public key of the account to check
   * @returns {Promise<ProtectionData | null>} The account's protection data or null if not found
   */
  public async getAccountStatus(accountPubkey: string): Promise<ProtectionData | null> {
    const cached = await this.getCachedData();
    if (!cached) return null;
    
    return cached.find(item => item.accountPubkey === accountPubkey) || null;
  }

  /**
   * Get all monitored accounts
   * @returns {Promise<string[]>} Array of public keys being monitored
   */
  public getMonitoredAccounts(): string[] {
    return [...this.accountPubkeys];
  }

  /**
   * Check if service is currently monitoring
   * @returns {boolean} Whether monitoring is in progress
   */
  public isCurrentlyMonitoring(): boolean {
    return this.isMonitoring;
  }
}
