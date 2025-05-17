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
    SET_DCA: Buffer.from([102, 102, 102, 102, 102, 102, 102, 102]),
    MOCK_BUY: Buffer.from([103, 103, 103, 103, 103, 103, 103, 103])
};

// DCA内容接口
export interface DCAContent extends Content {
    interval: number;
    tokenAddress: string;
    tokenAmount: number;
}

// 验证DCA内容
export function isDCAContent(content: any): content is DCAContent {
    return (
        typeof content.interval === "number" &&
        typeof content.tokenAddress === "string" &&
        typeof content.tokenAmount === "number" &&
        content.interval > 0 &&
        content.tokenAmount > 0
    );
}

// DCA自动化类
export class DCAAutomation {
    private connection: Connection;
    private wallet: Keypair;
    private accountPubkey: PublicKey;

    constructor(connection: Connection, wallet: Keypair, accountPubkey: PublicKey) {
        this.connection = connection;
        this.wallet = wallet;
        this.accountPubkey = accountPubkey;
    }

    // 创建设置DCA指令
    private createSetDCAInstruction(interval: number, tokenAddress: PublicKey, tokenAmount: number): TransactionInstruction {
        const data = Buffer.concat([
            INSTRUCTION_DISCRIMINATOR.SET_DCA,
            Buffer.from(new Uint8Array(new BigUint64Array([BigInt(interval)]).buffer)),
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

    // 创建模拟买入指令
    private createMockBuyInstruction(tokenAddress: PublicKey, tokenAmount: number): TransactionInstruction {
        const data = Buffer.concat([
            INSTRUCTION_DISCRIMINATOR.MOCK_BUY,
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

    // 设置DCA参数
    async setDCA(interval: number, tokenAddress: PublicKey, tokenAmount: number): Promise<string> {
        elizaLogger.log(`Setting DCA: interval=${interval}, token=${tokenAddress.toString()}, amount=${tokenAmount}`);
        
        const transaction = new Transaction().add(
            this.createSetDCAInstruction(interval, tokenAddress, tokenAmount)
        );

        const signature = await sendAndConfirmTransaction(
            this.connection,
            transaction,
            [this.wallet]
        );

        return signature;
    }

    // 执行模拟买入
    async mockBuy(tokenAddress: PublicKey, tokenAmount: number): Promise<string> {
        elizaLogger.log(`Executing mock buy: token=${tokenAddress.toString()}, amount=${tokenAmount}`);
        
        const transaction = new Transaction().add(
            this.createMockBuyInstruction(tokenAddress, tokenAmount)
        );

        const signature = await sendAndConfirmTransaction(
            this.connection,
            transaction,
            [this.wallet]
        );

        return signature;
    }
}

// DCA模板
const dcaTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "interval": 86400,
    "tokenAddress": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "tokenAmount": 100
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract the following information about the requested DCA setup:
- Interval in seconds (e.g. 86400 for daily)
- Token address (USDC by default: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)
- Token amount to buy each interval

Respond with a JSON markdown block containing only the extracted values.`;

// SET_DCA action定义
export const setDCAAction = {
    name: "SET_DCA",
    similes: ["CREATE_DCA", "SETUP_DCA", "START_DCA"],
    validate: async (_runtime: IAgentRuntime, _message: Memory) => {
        return true;
    },
    description: "Set up a Dollar Cost Averaging (DCA) automation to buy tokens at regular intervals.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("Starting SET_DCA handler...");

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
            const dcaContext = composeContext({
                state,
                template: dcaTemplate,
            });

            const content = await generateObject({
                runtime,
                context: dcaContext,
                modelClass: ModelClass.LARGE,
            });

            // 验证生成的内容
            if (!isDCAContent(content)) {
                elizaLogger.error("Invalid content for SET_DCA action.");
                if (callback) {
                    callback({
                        text: "Could not parse DCA parameters. Please specify interval, token_address and token_amount clearly.",
                    });
                }
                return false;
            }

            const { interval, tokenAddress, tokenAmount } = content;

            // 获取私钥并设置连接
            const privateKeyString =
                runtime.getSetting("SOLANA_PRIVATE_KEY") ??
                runtime.getSetting("WALLET_PRIVATE_KEY");
            const secretKey = bs58.decode(privateKeyString);
            const userKeypair = Keypair.fromSecretKey(secretKey);

            const connection = new Connection(settings.SOLANA_RPC_URL!, {
                commitment: "confirmed",
            });

            // 创建DCA自动化实例
            const automation = new DCAAutomation(
                connection,
                userKeypair,
                new PublicKey(accountPubkey)
            );

            // 执行设置DCA交易
            const tx = await automation.setDCA(
                interval,
                new PublicKey(tokenAddress),
                tokenAmount
            );

            if (callback) {
                callback({
                    text: `DCA setup completed successfully. Will buy ${tokenAmount} tokens every ${interval} seconds. Transaction: ${tx}`,
                    content: {
                        transaction: tx,
                        dcaInfo: {
                            interval,
                            tokenAddress,
                            tokenAmount,
                            timestamp: Date.now(),
                        },
                    },
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error("Error setting up DCA:", error);
            if (callback) {
                callback({
                    text: `Error setting up DCA: ${error.message}`,
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
                    text: "set up a daily DCA to buy 100 USDC",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "DCA setup completed successfully. Will buy 100 tokens every 86400 seconds. Transaction: 4stLVcC7jnQz1425fRQsJtZaQwj74huZd9GeKSiCdKVK4ZuQBBqpnXzxox7BYGVdx8YAgJKuDTrJfJ5VJnfhVKLr",
                    action: "SET_DCA",
                    content: {
                        transaction: "4stLVcC7jnQz1425fRQsJtZaQwj74huZd9GeKSiCdKVK4ZuQBBqpnXzxox7BYGVdx8YAgJKuDTrJfJ5VJnfhVKLr",
                        dcaInfo: {
                            interval: 86400,
                            tokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                            tokenAmount: 100,
                            timestamp: 1658747369123,
                        },
                    },
                },
            },
        ],
    ] as ActionExample[][],
};

// MOCK_BUY action定义
export const mockBuyAction = {
    name: "MOCK_BUY",
    similes: ["EXECUTE_DCA", "BUY_TOKENS"],
    validate: async (_runtime: IAgentRuntime, _message: Memory) => {
        return true;
    },
    description: "Execute a mock buy operation for DCA.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("Starting MOCK_BUY handler...");

        try {
            // 获取账户信息
            const accountPubkey = state.accountPubkey || runtime.getSetting("SIFTTT_ACCOUNT");
            if (!accountPubkey) {
                if (callback) {
                    callback({
                        text: "No account found. Please set up DCA first.",
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

            // 创建DCA自动化实例
            const automation = new DCAAutomation(
                connection,
                userKeypair,
                new PublicKey(accountPubkey)
            );

            // 执行模拟买入交易
            const tx = await automation.mockBuy(
                new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), // USDC
                100 // 默认买入100个
            );

            if (callback) {
                callback({
                    text: `Mock buy executed successfully. Transaction: ${tx}`,
                    content: {
                        transaction: tx,
                    },
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error("Error during mock buy:", error);
            if (callback) {
                callback({
                    text: `Error executing mock buy: ${error.message}`,
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
                    text: "execute mock buy",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Mock buy executed successfully. Transaction: 3uNPTyCCPLpZs3WV5KjEU3kZu4aW8NWvxVgQJNgyLmS5TQzkDeFRpgGQJwMac72fXj8z8A9AoC6YZd4AAxhpGqy4",
                    action: "MOCK_BUY",
                    content: {
                        transaction: "3uNPTyCCPLpZs3WV5KjEU3kZu4aW8NWvxVgQJNgyLmS5TQzkDeFRpgGQJwMac72fXj8z8A9AoC6YZd4AAxhpGqy4",
                    },
                },
            },
        ],
    ] as ActionExample[][],
};

// 导出所有actions
export default [
    setDCAAction,
    mockBuyAction,
] as Action[];
