import { Service, ServiceType } from "@elizaos/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { settings } from "@elizaos/core";
import bs58 from "bs58";
import { elizaLogger } from "@elizaos/core";
import { ProtectionAutomation } from "../actions/protection_automation";

export class ProtectionService extends Service {
    //static serviceType: ServiceType = ServiceType.TRANSCRIPTION;

    private connection: Connection;
    private wallet: Keypair;
    private automation: ProtectionAutomation | null = null;
    private checkInterval: NodeJS.Timeout | null = null;
    private readonly CHECK_INTERVAL_MS = 60000; // 每分钟检查一次

    constructor() {
        super("ProtectionService");
        this.connection = new Connection(settings.SOLANA_RPC_URL!, {
            commitment: "confirmed",
        });
    }

    get serviceType(): ServiceType {
      return ServiceType.TRANSCRIPTION;
    }

    async initialize(): Promise<void> {
        try {
            // 从设置中获取私钥
            const privateKeyString = settings.SOLANA_PRIVATE_KEY ?? settings.WALLET_PRIVATE_KEY;
            if (!privateKeyString) {
                throw new Error("No private key found in settings");
            }

            // 创建钱包
            const secretKey = bs58.decode(privateKeyString);
            this.wallet = Keypair.fromSecretKey(secretKey);

            // 从设置中获取账户地址
            const accountPubkey = settings.SIFTTT_ACCOUNT;
            if (!accountPubkey) {
                throw new Error("No SIFTTT account found in settings");
            }

            // 初始化自动化实例
            this.automation = new ProtectionAutomation(
                this.connection,
                this.wallet,
                new PublicKey(accountPubkey)
            );

            // 启动定时检查
            this.startHealthCheck();

            elizaLogger.log("ProtectionService initialized successfully");
        } catch (error) {
            elizaLogger.error("Failed to initialize ProtectionService:", error);
            throw error;
        }
    }

    private startHealthCheck(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }

        this.checkInterval = setInterval(async () => {
            try {
                await this.checkAndTriggerProtection();
            } catch (error) {
                elizaLogger.error("Error in health check:", error);
            }
        }, this.CHECK_INTERVAL_MS);

        elizaLogger.log("Health check started");
    }

    private async checkAndTriggerProtection(): Promise<void> {
        if (!this.automation) {
            elizaLogger.error("Automation not initialized");
            return;
        }

        try {
            const state = await this.automation.getAccountState();
            
            elizaLogger.log("Current protection state:", {
                healthFactor: state.healthFactor,
                triggerHealthFactor: state.triggerHealthFactor,
                targetHealthFactor: state.targetHealthFactor,
                automationEnabled: state.automationEnabled
            });

            // 检查是否需要触发保护
            if (state.automationEnabled && 
                state.healthFactor <= state.triggerHealthFactor) {
                
                elizaLogger.log("Triggering auto-repay protection...");
                
                const tx = await this.automation.autoRepay();
                const newState = await this.automation.getAccountState();
                
                elizaLogger.log("Auto-repay executed successfully", {
                    transaction: tx,
                    previousHealthFactor: state.healthFactor,
                    newHealthFactor: newState.healthFactor
                });
            }
        } catch (error) {
            elizaLogger.error("Error checking protection status:", error);
        }
    }

    async stop(): Promise<void> {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        elizaLogger.log("ProtectionService stopped");
    }
}

// 导出服务实例
export const protectionService = new ProtectionService();
