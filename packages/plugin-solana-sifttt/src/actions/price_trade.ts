import { 
    PublicKey, 
    Connection, 
    Keypair, 
    Transaction, 
    SystemProgram,
    TransactionInstruction,
    sendAndConfirmTransaction
} from '@solana/web3.js';
import { elizaLogger } from "@elizaos/core";
import bs58 from "bs58";
import {
    settings,
    type ActionExample,
    type Content,
    type HandlerCallback,
    type IAgentRuntime,
    type Memory,
    ModelClass,
    type State,
    generateObject,
    composeContext,
    type Action,
} from "@elizaos/core";

// Contract program ID
const PROGRAM_ID = new PublicKey(process.env.SIFTTT_PROGRAM_ID || 'BU5JMEZ6mwqjSBMWTrh2NF96SMHdjz5JU3nk526LjPdA');

// 指令的discriminator
const INSTRUCTION_DISCRIMINATOR = {
    SET_PRICE_TRADING: Buffer.from([104, 104, 104, 104, 104, 104, 104, 104]),
    EXECUTE_PRICE_TRADE: Buffer.from([105, 105, 105, 105, 105, 105, 105, 105])
};

// Price Trade内容接口
export interface PriceTradeContent extends Content {
    targetPrice: number;
    tokenAddress: string;
    tokenAmount: number;
}

// 验证Price Trade内容
export function isPriceTradeContent(content: any): content is PriceTradeContent {
    return (
        typeof content.targetPrice === "number" &&
        typeof content.tokenAddress === "string" &&
        typeof content.tokenAmount === "number" &&
        content.targetPrice > 0 &&
        content.tokenAmount > 0
    );
}

// Price Trade自动化类
export class PriceTradeAutomation {
    private connection: Connection;
    private wallet: Keypair;
    private accountPubkey: PublicKey;

    constructor(connection: Connection, wallet: Keypair, accountPubkey: PublicKey) {
        this.connection = connection;
        this.wallet = wallet;
        this.accountPubkey = accountPubkey;
    }

    // 创建设置价格交易指令
    private createSetPriceTradingInstruction(targetPrice: number, tokenAddress: PublicKey, tokenAmount: number): TransactionInstruction {
        const data = Buffer.concat([
            INSTRUCTION_DISCRIMINATOR.SET_PRICE_TRADING,
            Buffer.from(new Uint8Array(new BigUint64Array([BigInt(targetPrice)]).buffer)),
            tokenAddress.toBytes(),
            Buffer.from(new Uint8Array(new BigUint64Array([BigInt(tokenAmount)]).buffer))
        ]);

        return new TransactionInstruction({
            keys: [
                { pubkey: this.accountPubkey, isSigner: false, isWritable: true },
                { pubkey: this.wallet.publicKey, isSigner: true, isWritable: false }
            ],
            programId: PROGRAM_ID,
            data
        });
    }

    // 创建执行价格交易指令
    private createExecutePriceTradeInstruction(currentPrice: number): TransactionInstruction {
        const data = Buffer.concat([
            INSTRUCTION_DISCRIMINATOR.EXECUTE_PRICE_TRADE,
            Buffer.from(new Uint8Array(new BigUint64Array([BigInt(currentPrice)]).buffer))
        ]);

        return new TransactionInstruction({
            keys: [
                { pubkey: this.accountPubkey, isSigner: false, isWritable: true },
                { pubkey: this.wallet.publicKey, isSigner: true, isWritable: false }
            ],
            programId: PROGRAM_ID,
            data
        });
    }

    // 设置价格交易参数
    async setPriceTrading(targetPrice: number, tokenAddress: PublicKey, tokenAmount: number): Promise<string> {
        elizaLogger.log(`Setting price trading: target=${targetPrice}, token=${tokenAddress.toString()}, amount=${tokenAmount}`);
        
        const transaction = new Transaction().add(
            this.createSetPriceTradingInstruction(targetPrice, tokenAddress, tokenAmount)
        );

        const signature = await sendAndConfirmTransaction(
            this.connection,
            transaction,
            [this.wallet]
        );

        return signature;
    }

    // 执行价格交易
    async executePriceTrade(currentPrice: number): Promise<string> {
        elizaLogger.log(`Executing price trade with current price: ${currentPrice}`);
        
        const transaction = new Transaction().add(
            this.createExecutePriceTradeInstruction(currentPrice)
        );

        const signature = await sendAndConfirmTransaction(
            this.connection,
            transaction,
            [this.wallet]
        );

        return signature;
    }
}

// Price Trade模板
const priceTradeTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "targetPrice": 1.5,
    "tokenAddress": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "tokenAmount": 1000
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract the following information about the requested price trading setup:
- Target price to trigger the trade
- Token address (USDC by default: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)
- Token amount to trade

Respond with a JSON markdown block containing only the extracted values.`;

// SET_PRICE_TRADING action定义
export const setPriceTradingAction = {
    name: "SET_PRICE_TRADING",
    similes: ["CREATE_PRICE_TRADE", "SETUP_PRICE_TRADE", "START_PRICE_TRADE"],
    validate: async (_runtime: IAgentRuntime, _message: Memory) => {
        return true;
    },
    description: "Set up a price-based trading automation to buy tokens when price reaches target.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("Starting SET_PRICE_TRADING handler...");

        try {
            // 获取账户信息
            const accountPubkey = state.accountPubkey || runtime.getSetting("SIFTTT_ACCOUNT");
            if (!accountPubkey) {
                if (callback) {
                    callback({
                        text: "No account found. Please set up protection automation first.",
                    });
                }
                return false;
            }

            // 生成结构化内容
            const priceTradeContext = composeContext({
                state,
                template: priceTradeTemplate,
            });

            const content = await generateObject({
                runtime,
                context: priceTradeContext,
                modelClass: ModelClass.LARGE,
            });

            // 验证生成的内容
            if (!isPriceTradeContent(content)) {
                elizaLogger.error("Invalid content for SET_PRICE_TRADING action.");
                if (callback) {
                    callback({
                        text: "Could not parse price trading parameters. Please specify target_price, token_address and token_amount clearly.",
                    });
                }
                return false;
            }

            const { targetPrice, tokenAddress, tokenAmount } = content;

            // 获取私钥并设置连接
            const privateKeyString =
                runtime.getSetting("SOLANA_PRIVATE_KEY") ??
                runtime.getSetting("WALLET_PRIVATE_KEY");
            const secretKey = bs58.decode(privateKeyString);
            const userKeypair = Keypair.fromSecretKey(secretKey);

            const connection = new Connection(settings.SOLANA_RPC_URL!, {
                commitment: "confirmed",
            });

            // 创建Price Trade自动化实例
            const automation = new PriceTradeAutomation(
                connection,
                userKeypair,
                new PublicKey(accountPubkey)
            );

            // 执行设置价格交易
            const tx = await automation.setPriceTrading(
                targetPrice,
                new PublicKey(tokenAddress),
                tokenAmount
            );

            if (callback) {
                callback({
                    text: `Price trading setup completed successfully. Will buy ${tokenAmount} tokens when price reaches ${targetPrice}. Transaction: ${tx}`,
                    content: {
                        transaction: tx,
                        priceTradeInfo: {
                            targetPrice,
                            tokenAddress,
                            tokenAmount,
                            timestamp: Date.now(),
                        },
                    },
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error("Error setting up price trading:", error);
            if (callback) {
                callback({
                    text: `Error setting up price trading: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "set up price trading to buy 1000 USDC when price reaches 1.5",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Price trading setup completed successfully. Will buy 1000 tokens when price reaches 1.5. Transaction: 4stLVcC7jnQz1425fRQsJtZaQwj74huZd9GeKSiCdKVK4ZuQBBqpnXzxox7BYGVdx8YAgJKuDTrJfJ5VJnfhVKLr",
                    action: "SET_PRICE_TRADING",
                    content: {
                        transaction: "4stLVcC7jnQz1425fRQsJtZaQwj74huZd9GeKSiCdKVK4ZuQBBqpnXzxox7BYGVdx8YAgJKuDTrJfJ5VJnfhVKLr",
                        priceTradeInfo: {
                            targetPrice: 1.5,
                            tokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                            tokenAmount: 1000,
                            timestamp: 1658747369123,
                        },
                    },
                },
            },
        ],
    ] as ActionExample[][],
};

// EXECUTE_PRICE_TRADE action定义
export const executePriceTradeAction = {
    name: "EXECUTE_PRICE_TRADE",
    similes: ["TRIGGER_PRICE_TRADE", "BUY_AT_PRICE"],
    validate: async (_runtime: IAgentRuntime, _message: Memory) => {
        return true;
    },
    description: "Execute a price-based trade with current market price.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("Starting EXECUTE_PRICE_TRADE handler...");

        try {
            // 获取账户信息
            const accountPubkey = state.accountPubkey || runtime.getSetting("SIFTTT_ACCOUNT");
            if (!accountPubkey) {
                if (callback) {
                    callback({
                        text: "No account found. Please set up price trading first.",
                    });
                }
                return false;
            }

            // 获取私钥并设置连接
            const privateKeyString =
                runtime.getSetting("SOLANA_PRIVATE_KEY") ??
                runtime.getSetting("WALLET_PRIVATE_KEY");
            const secretKey = bs58.decode(privateKeyString);
            const userKeypair = Keypair.fromSecretKey(secretKey);

            const connection = new Connection(settings.SOLANA_RPC_URL!, {
                commitment: "confirmed",
            });

            // 创建Price Trade自动化实例
            const automation = new PriceTradeAutomation(
                connection,
                userKeypair,
                new PublicKey(accountPubkey)
            );

            // 执行价格交易
            const currentPrice = 1.4; // 这里应该从外部获取当前价格
            const tx = await automation.executePriceTrade(currentPrice);

            if (callback) {
                callback({
                    text: `Price trade executed successfully at price ${currentPrice}. Transaction: ${tx}`,
                    content: {
                        transaction: tx,
                        currentPrice,
                    },
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error("Error during price trade:", error);
            if (callback) {
                callback({
                    text: `Error executing price trade: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "execute price trade",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Price trade executed successfully at price 1.4. Transaction: 3uNPTyCCPLpZs3WV5KjEU3kZu4aW8NWvxVgQJNgyLmS5TQzkDeFRpgGQJwMac72fXj8z8A9AoC6YZd4AAxhpGqy4",
                    action: "EXECUTE_PRICE_TRADE",
                    content: {
                        transaction: "3uNPTyCCPLpZs3WV5KjEU3kZu4aW8NWvxVgQJNgyLmS5TQzkDeFRpgGQJwMac72fXj8z8A9AoC6YZd4AAxhpGqy4",
                        currentPrice: 1.4,
                    },
                },
            },
        ],
    ] as ActionExample[][],
};

// 导出所有actions
export default [
    setPriceTradingAction,
    executePriceTradeAction,
] as Action[];
