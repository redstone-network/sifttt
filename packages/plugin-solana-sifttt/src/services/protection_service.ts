import { Service, ServiceType } from "@elizaos/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { settings } from "@elizaos/core";
import bs58 from "bs58";
import { elizaLogger } from "@elizaos/core";
import { ProtectionAutomation } from "../actions/protection_automation";
import { DCAAutomation } from "../actions/dca";
import { PriceTradeAutomation } from "../actions/price_trade";
import { mockPriceService } from "./mock_price_service";

export class ProtectionService extends Service {
    private connection: Connection;
    private wallet: Keypair;
    private automation: ProtectionAutomation | null = null;
    private dcaAutomation: DCAAutomation | null = null;
    private priceTradeAutomation: PriceTradeAutomation | null = null;
    private checkInterval: NodeJS.Timeout | null = null;
    private readonly CHECK_INTERVAL_MS = 60000; // 每分钟检查一次
    private lastDCATime: number = 0; // 记录上次DCA执行时间

    constructor() {
        super();
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

            const accountPublicKey = new PublicKey(accountPubkey);

            // 初始化各个自动化实例
            this.automation = new ProtectionAutomation(
                this.connection,
                this.wallet,
                accountPublicKey
            );

            this.dcaAutomation = new DCAAutomation(
                this.connection,
                this.wallet,
                accountPublicKey
            );

            this.priceTradeAutomation = new PriceTradeAutomation(
                this.connection,
                this.wallet,
                accountPublicKey
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
                await this.checkAndExecuteDCA();
                await this.checkAndExecutePriceTrade();
            } catch (error) {
                elizaLogger.error("Error in health check:", error);
            }
        }, this.CHECK_INTERVAL_MS);

        elizaLogger.log("Health check started");
    }

    private async checkAndTriggerProtection(): Promise<void> {
        if (!this.automation) {
            elizaLogger.error("Protection automation not initialized");
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

    private async checkAndExecuteDCA(): Promise<void> {
        if (!this.dcaAutomation) {
            elizaLogger.error("DCA automation not initialized");
            return;
        }

        try {
            // 获取账户状态
            const accountInfo = await this.connection.getAccountInfo(this.dcaAutomation.getAccountPublicKey());
            if (!accountInfo) {
                throw new Error("Account not found");
            }

            // 解析账户数据
            const data = accountInfo.data;
            const dcaInterval = Number(new BigUint64Array(data.slice(40, 48).buffer)[0]);
            const dcaEnabled = Boolean(data[88]);
            const tokenAddress = new PublicKey(data.slice(48, 80));
            const tokenAmount = Number(new BigUint64Array(data.slice(80, 88).buffer)[0]);

            if (!dcaEnabled || dcaInterval <= 0) {
                return;
            }

            const now = Date.now();
            if (now - this.lastDCATime >= dcaInterval * 1000) {
                elizaLogger.log("Executing DCA...");
                
                const tx = await this.dcaAutomation.mockBuy(tokenAddress, tokenAmount);
                this.lastDCATime = now;
                
                elizaLogger.log("DCA executed successfully", {
                    transaction: tx,
                    tokenAddress: tokenAddress.toString(),
                    tokenAmount
                });
            }
        } catch (error) {
            elizaLogger.error("Error checking DCA status:", error);
        }
    }

    private async checkAndExecutePriceTrade(): Promise<void> {
        if (!this.priceTradeAutomation) {
            elizaLogger.error("Price trade automation not initialized");
            return;
        }

        try {
            // 获取账户状态
            const accountInfo = await this.connection.getAccountInfo(this.priceTradeAutomation.getAccountPublicKey());
            if (!accountInfo) {
                throw new Error("Account not found");
            }

            // 解析账户数据
            const data = accountInfo.data;
            const targetPrice = Number(new BigUint64Array(data.slice(89, 97).buffer)[0]);
            const priceTradingEnabled = Boolean(data[137]);
            const tokenAddress = new PublicKey(data.slice(97, 129));
            const tokenAmount = Number(new BigUint64Array(data.slice(129, 137).buffer)[0]);

            if (!priceTradingEnabled || targetPrice <= 0) {
                return;
            }

            // 获取当前价格
            const currentPrice = mockPriceService.getCurrentPrice(tokenAddress.toString());
            
            if (currentPrice <= targetPrice) {
                elizaLogger.log("Price condition met, executing trade...", {
                    currentPrice,
                    targetPrice
                });
                
                const tx = await this.priceTradeAutomation.executePriceTrade(currentPrice);
                
                elizaLogger.log("Price trade executed successfully", {
                    transaction: tx,
                    currentPrice,
                    targetPrice,
                    tokenAddress: tokenAddress.toString(),
                    tokenAmount
                });
            }
        } catch (error) {
            elizaLogger.error("Error checking price trade status:", error);
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
