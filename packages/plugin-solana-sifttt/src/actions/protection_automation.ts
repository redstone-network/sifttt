import { 
    PublicKey, 
    Connection, 
    Keypair, 
    Transaction, 
    SystemProgram,
    TransactionInstruction,
    sendAndConfirmTransaction,
    LAMPORTS_PER_SOL
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

import { walletProvider } from "../providers/wallet";

// Contract program ID
const PROGRAM_ID = new PublicKey(process.env.SIFTTT_PROGRAM_ID || 'BU5JMEZ6mwqjSBMWTrh2NF96SMHdjz5JU3nk526LjPdA');

// 指令的discriminator
const INSTRUCTION_DISCRIMINATOR = {
    INITIALIZE: Buffer.from([97, 97, 97, 97, 97, 97, 97, 97]), // 8 bytes
    SET_AUTOMATION: Buffer.from([98, 98, 98, 98, 98, 98, 98, 98]),
    BORROW: Buffer.from([99, 99, 99, 99, 99, 99, 99, 99]),
    REPAY: Buffer.from([100, 100, 100, 100, 100, 100, 100, 100]),
    AUTO_REPAY: Buffer.from([101, 101, 101, 101, 101, 101, 101, 101])
};

// 账户状态数据结构
interface AccountState {
    healthFactor: number;
    triggerHealthFactor: number;
    targetHealthFactor: number;
    automationEnabled: boolean;
}

export interface ProtectionAutomationContent extends Content {
    triggerHealthFactor: number;
    targetHealthFactor: number;
}

export function isProtectionAutomationContent(content: any): content is ProtectionAutomationContent {
    elizaLogger.log("Content for protection automation", content);
    return (
        typeof content.triggerHealthFactor === "number" &&
        typeof content.targetHealthFactor === "number" &&
        content.targetHealthFactor > content.triggerHealthFactor
    );
}

export class ProtectionAutomation {
    private connection: Connection;
    private wallet: Keypair;
    private accountPubkey: PublicKey;

    constructor(connection: Connection, wallet: Keypair, accountPubkey: PublicKey) {
        this.connection = connection;
        this.wallet = wallet;
        this.accountPubkey = accountPubkey;
    }

    // 创建初始化指令
    private createInitializeInstruction(newAccount: PublicKey): TransactionInstruction {
        const data = Buffer.concat([
            INSTRUCTION_DISCRIMINATOR.INITIALIZE
        ]);

        return new TransactionInstruction({
            keys: [
                { pubkey: newAccount, isSigner: true, isWritable: true },
                { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
            ],
            programId: PROGRAM_ID,
            data
        });
    }

    // 创建设置自动化指令
    private createSetAutomationInstruction(triggerHealthFactor: number, targetHealthFactor: number): TransactionInstruction {
        const data = Buffer.concat([
            INSTRUCTION_DISCRIMINATOR.SET_AUTOMATION,
            Buffer.from(new Uint8Array(new BigUint64Array([BigInt(triggerHealthFactor)]).buffer)),
            Buffer.from(new Uint8Array(new BigUint64Array([BigInt(targetHealthFactor)]).buffer))
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

    // 创建借贷指令
    private createBorrowInstruction(): TransactionInstruction {
        const data = Buffer.concat([
            INSTRUCTION_DISCRIMINATOR.BORROW
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

    // 创建还款指令
    private createRepayInstruction(): TransactionInstruction {
        const data = Buffer.concat([
            INSTRUCTION_DISCRIMINATOR.REPAY
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

    // 创建自动还款指令
    private createAutoRepayInstruction(): TransactionInstruction {
        const data = Buffer.concat([
            INSTRUCTION_DISCRIMINATOR.AUTO_REPAY
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

    // 初始化账户
    async initialize(): Promise<PublicKey> {
        const newAccount = Keypair.generate();
        const transaction = new Transaction().add(
            this.createInitializeInstruction(newAccount.publicKey)
        );

        await sendAndConfirmTransaction(
            this.connection,
            transaction,
            [this.wallet, newAccount]
        );

        this.accountPubkey = newAccount.publicKey;
        return newAccount.publicKey;
    }

    // 设置自动化参数
    async setAutomation(triggerHealthFactor: number, targetHealthFactor: number): Promise<string> {
        elizaLogger.log(`Setting automation: trigger=${triggerHealthFactor}, target=${targetHealthFactor}`);
        
        const transaction = new Transaction().add(
            this.createSetAutomationInstruction(triggerHealthFactor, targetHealthFactor)
        );

        const signature = await sendAndConfirmTransaction(
            this.connection,
            transaction,
            [this.wallet]
        );

        return signature;
    }

    // 执行借贷操作
    async borrow(): Promise<string> {
        elizaLogger.log("Executing borrow operation");
        
        const transaction = new Transaction().add(
            this.createBorrowInstruction()
        );

        const signature = await sendAndConfirmTransaction(
            this.connection,
            transaction,
            [this.wallet]
        );

        return signature;
    }

    // 执行还款操作
    async repay(): Promise<string> {
        elizaLogger.log("Executing repay operation");
        
        const transaction = new Transaction().add(
            this.createRepayInstruction()
        );

        const signature = await sendAndConfirmTransaction(
            this.connection,
            transaction,
            [this.wallet]
        );

        return signature;
    }

    // 执行自动还款
    async autoRepay(): Promise<string> {
        elizaLogger.log("Executing auto-repay operation");
        
        const transaction = new Transaction().add(
            this.createAutoRepayInstruction()
        );

        const signature = await sendAndConfirmTransaction(
            this.connection,
            transaction,
            [this.wallet]
        );

        return signature;
    }

    // 获取账户状态
    async getAccountState(): Promise<AccountState> {
        //elizaLogger.error("@@@ in getAccountState...");
        const accountInfo = await this.connection.getAccountInfo(this.accountPubkey);
        if (!accountInfo) {
            //elizaLogger.error("@@@ Account not found...");
            throw new Error("Account not found");
        }
        //elizaLogger.error("@@@ after getAccountInfo...");
        // 解析账户数据
        const data = accountInfo.data;
        const healthFactor = Number(new BigUint64Array(data.slice(8, 16).buffer)[0]);
        const triggerHealthFactor = Number(new BigUint64Array(data.slice(16, 24).buffer)[0]);
        const targetHealthFactor = Number(new BigUint64Array(data.slice(24, 32).buffer)[0]);
        const automationEnabled = Boolean(data[32]);

        return {
            healthFactor,
            triggerHealthFactor,
            targetHealthFactor,
            automationEnabled
        };
    }

    // 获取账户公钥
    getAccountPublicKey(): PublicKey {
        return this.accountPubkey;
    }
}

const automationTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "triggerHealthFactor": 70,
    "targetHealthFactor": 90
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract the following information about the requested protection automation:
- Trigger health factor (threshold below which automation will be triggered)
- Target health factor (the value to restore to)

Respond with a JSON markdown block containing only the extracted values.`;

// SET_AUTOMATION action definition
export const setAutomationAction = {
    name: "SET_AUTOMATION",
    similes: ["CREATE_PROTECTION", "SETUP_AUTOMATION"],
    validate: async (_runtime: IAgentRuntime, _message: Memory) => {
        return true;
    },
    description: "Set up a protection automation with trigger and target health factors to prevent liquidation.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("Starting SET_AUTOMATION handler...");

        // Compose state if not provided
        if (!state) {
            state = (await runtime.composeState(message)) as State;
        } else {
            state = await runtime.updateRecentMessageState(state);
        }

        // Get wallet info for context
        const walletInfo = await walletProvider.get(runtime, message, state);
        state.walletInfo = walletInfo;

        // Generate structured content from natural language
        const automationContext = composeContext({
            state,
            template: automationTemplate,
        });

        const content = await generateObject({
            runtime,
            context: automationContext,
            modelClass: ModelClass.LARGE,
        });

        // Validate the generated content
        if (!isProtectionAutomationContent(content)) {
            elizaLogger.error("Invalid content for SET_AUTOMATION action.");
            if (callback) {
                callback({
                    text: "Could not parse automation parameters. Please specify trigger_health_factor and target_health_factor clearly.",
                });
            }
            return false;
        }

        const { triggerHealthFactor, targetHealthFactor } = content;

        try {
            // Get private key from settings and create deployer keypair
            const privateKeyString =
                runtime.getSetting("SOLANA_PRIVATE_KEY") ??
                runtime.getSetting("WALLET_PRIVATE_KEY");
            const secretKey = bs58.decode(privateKeyString);
            const userKeypair = Keypair.fromSecretKey(secretKey);

            // Setup connection
            const connection = new Connection(settings.SOLANA_RPC_URL!, {
                commitment: "confirmed",
                confirmTransactionInitialTimeout: 60000,
                wsEndpoint: settings.SOLANA_RPC_URL!.replace("https", "wss"),
            });

            // Create a new protection automation instance
            const result = await createProtectionAutomation(
                connection,
                userKeypair,
                triggerHealthFactor,
                targetHealthFactor
            );

            if (callback) {
                callback({
                    text: result.result,
                    content: {
                        automationInfo: {
                            account: result.automation.accountPubkey.toString(),
                            triggerHealthFactor,
                            targetHealthFactor,
                            timestamp: Date.now(),
                        },
                    },
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error("Error setting up automation:", error);
            if (callback) {
                callback({
                    text: `Error setting up protection automation: ${error.message}`,
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
                    text: "create a Protection Automation, trigger_health_factor is 70, target_health_factor is 90",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Protection automation created successfully with account 7XB3rs1UJPSLfd9DpGzCkV8CqpzR3Vc6KQCVjcuxeVbB. Transaction: 4stLVcC7jnQz1425fRQsJtZaQwj74huZd9GeKSiCdKVK4ZuQBBqpnXzxox7BYGVdx8YAgJKuDTrJfJ5VJnfhVKLr",
                    action: "SET_AUTOMATION",
                    content: {
                        automationInfo: {
                            account: "7XB3rs1UJPSLfd9DpGzCkV8CqpzR3Vc6KQCVjcuxeVbB",
                            triggerHealthFactor: 70,
                            targetHealthFactor: 90,
                            timestamp: 1658747369123,
                        },
                    },
                },
            },
        ],
    ] as ActionExample[][],
};

// BORROW action definition
export const borrowAction = {
    name: "BORROW",
    similes: ["TAKE_LOAN", "BORROW_TOKENS"],
    validate: async (_runtime: IAgentRuntime, _message: Memory) => {
        return true;
    },
    description: "Execute a borrow operation which decreases the health factor.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("Starting BORROW handler...");

        try {
            // Get account information from state or settings
            const accountPubkey = state.accountPubkey || runtime.getSetting("SIFTTT_ACCOUNT");
            if (!accountPubkey) {
                if (callback) {
                    callback({
                        text: "No account found. Please set up protection automation first.",
                    });
                }
                return false;
            }

            // Get private key and set up connection
            const privateKeyString =
                runtime.getSetting("SOLANA_PRIVATE_KEY") ??
                runtime.getSetting("WALLET_PRIVATE_KEY");
            const secretKey = bs58.decode(privateKeyString);
            const userKeypair = Keypair.fromSecretKey(secretKey);

            const connection = new Connection(settings.SOLANA_RPC_URL!, {
                commitment: "confirmed",
            });

            // Create protection automation instance
            const automation = new ProtectionAutomation(
                connection,
                userKeypair,
                new PublicKey(accountPubkey)
            );

            // Execute borrow transaction
            const tx = await automation.borrow();
            const newState = await automation.getAccountState();

            if (callback) {
                callback({
                    text: `Borrow transaction completed successfully. Your health factor is now ${newState.healthFactor}. Transaction: ${tx}`,
                    content: {
                        transaction: tx,
                        healthFactor: newState.healthFactor,
                    },
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error("Error during borrow operation:", error);
            if (callback) {
                callback({
                    text: `Error executing borrow operation: ${error.message}`,
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
                    text: "borrow",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Borrow transaction completed successfully. Your health factor is now 90. Transaction: 3uNPTyCCPLpZs3WV5KjEU3kZu4aW8NWvxVgQJNgyLmS5TQzkDeFRpgGQJwMac72fXj8z8A9AoC6YZd4AAxhpGqy4",
                    action: "BORROW",
                    content: {
                        transaction: "3uNPTyCCPLpZs3WV5KjEU3kZu4aW8NWvxVgQJNgyLmS5TQzkDeFRpgGQJwMac72fXj8z8A9AoC6YZd4AAxhpGqy4",
                        healthFactor: 90,
                    },
                },
            },
        ],
    ] as ActionExample[][],
};

// REPAY action definition
export const repayAction = {
    name: "REPAY",
    similes: ["PAY_BACK", "REPAY_LOAN"],
    validate: async (_runtime: IAgentRuntime, _message: Memory) => {
        return true;
    },
    description: "Execute a repay operation which increases the health factor.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("Starting REPAY handler...");

        try {
            // Get account information from state or settings
            const accountPubkey = state.accountPubkey || runtime.getSetting("SIFTTT_ACCOUNT");
            if (!accountPubkey) {
                if (callback) {
                    callback({
                        text: "No account found. Please set up protection automation first.",
                    });
                }
                return false;
            }

            // Get private key and set up connection
            const privateKeyString =
                runtime.getSetting("SOLANA_PRIVATE_KEY") ??
                runtime.getSetting("WALLET_PRIVATE_KEY");
            const secretKey = bs58.decode(privateKeyString);
            const userKeypair = Keypair.fromSecretKey(secretKey);

            const connection = new Connection(settings.SOLANA_RPC_URL!, {
                commitment: "confirmed",
            });

            // Create protection automation instance
            const automation = new ProtectionAutomation(
                connection,
                userKeypair,
                new PublicKey(accountPubkey)
            );

            // Execute repay transaction
            const tx = await automation.repay();
            const newState = await automation.getAccountState();

            if (callback) {
                callback({
                    text: `Repay transaction completed successfully. Your health factor is now ${newState.healthFactor}. Transaction: ${tx}`,
                    content: {
                        transaction: tx,
                        healthFactor: newState.healthFactor,
                    },
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error("Error during repay operation:", error);
            if (callback) {
                callback({
                    text: `Error executing repay operation: ${error.message}`,
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
                    text: "repay",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Repay transaction completed successfully. Your health factor is now 95. Transaction: 5pZ8pJ4B1ebVtbRJhGF4Lp7JJesZd9bSZr8AWs9xzynK5QQuNjJ9n72c9YpbHwLFmnN6aqLiiAZey4HLwZx5Nkt7",
                    action: "REPAY",
                    content: {
                        transaction: "5pZ8pJ4B1ebVtbRJhGF4Lp7JJesZd9bSZr8AWs9xzynK5QQuNjJ9n72c9YpbHwLFmnN6aqLiiAZey4HLwZx5Nkt7",
                        healthFactor: 95,
                    },
                },
            },
        ],
    ] as ActionExample[][],
};

// AUTO_REPAY action definition
export const autoRepayAction = {
    name: "AUTO_REPAY",
    similes: ["TRIGGER_PROTECTION", "EXECUTE_AUTOMATION"],
    validate: async (_runtime: IAgentRuntime, _message: Memory) => {
        return true;
    },
    description: "Manually trigger the auto-repay functionality to restore health factor.",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("Starting AUTO_REPAY handler...");

        try {
            // Get account information from state or settings
            const accountPubkey = state.accountPubkey || runtime.getSetting("SIFTTT_ACCOUNT");
            if (!accountPubkey) {
                if (callback) {
                    callback({
                        text: "No account found. Please set up protection automation first.",
                    });
                }
                return false;
            }

            // Get private key and set up connection
            const privateKeyString =
                runtime.getSetting("SOLANA_PRIVATE_KEY") ??
                runtime.getSetting("WALLET_PRIVATE_KEY");
            const secretKey = bs58.decode(privateKeyString);
            const userKeypair = Keypair.fromSecretKey(secretKey);

            const connection = new Connection(settings.SOLANA_RPC_URL!, {
                commitment: "confirmed",
            });

            // Create protection automation instance
            const automation = new ProtectionAutomation(
                connection,
                userKeypair,
                new PublicKey(accountPubkey)
            );

            // Check current state before auto-repay
            const currentState = await automation.getAccountState();
            if (currentState.healthFactor > currentState.triggerHealthFactor) {
                if (callback) {
                    callback({
                        text: `Auto-repay not needed. Current health factor (${currentState.healthFactor}) is above trigger threshold (${currentState.triggerHealthFactor}).`,
                        content: {
                            healthFactor: currentState.healthFactor,
                            triggerHealthFactor: currentState.triggerHealthFactor,
                        },
                    });
                }
                return true;
            }

            // Execute auto-repay transaction
            const tx = await automation.autoRepay();
            const newState = await automation.getAccountState();

            if (callback) {
                callback({
                    text: `Auto-repay executed successfully. Health factor restored from ${currentState.healthFactor} to ${newState.healthFactor}. Transaction: ${tx}`,
                    content: {
                        transaction: tx,
                        previousHealthFactor: currentState.healthFactor,
                        newHealthFactor: newState.healthFactor,
                    },
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error("Error during auto-repay operation:", error);
            if (callback) {
                callback({
                    text: `Error executing auto-repay: ${error.message}`,
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
                    text: "trigger protection",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Auto-repay executed successfully. Health factor restored from 65 to 90. Transaction: 2ZH5PeUDXxT8x6RXtdGxs4PqsUbxgGzjkQQsv1mTXz8CEtG9s4cBqKDFJV6uVFXPrYZ2LabFWmjHbhBuHB9cYrE8",
                    action: "AUTO_REPAY",
                    content: {
                        transaction: "2ZH5PeUDXxT8x6RXtdGxs4PqsUbxgGzjkQQsv1mTXz8CEtG9s4cBqKDFJV6uVFXPrYZ2LabFWmjHbhBuHB9cYrE8",
                        previousHealthFactor: 65,
                        newHealthFactor: 90,
                    },
                },
            },
        ],
    ] as ActionExample[][],
};

/**
 * Creates a new protection automation instance with the specified parameters
 * @param connection - Solana connection
 * @param wallet - User wallet
 * @param triggerHealthFactor - Health factor trigger threshold
 * @param targetHealthFactor - Target health factor to restore to
 * @returns New ProtectionAutomation instance and transaction result
 */
export async function createProtectionAutomation(
    connection: Connection,
    wallet: any,
    triggerHealthFactor: number,
    targetHealthFactor: number
): Promise<{ automation: ProtectionAutomation; result: string }> {
    try {
        // Initialize new account
        const automation = new ProtectionAutomation(connection, wallet, null);
        const accountPubkey = await automation.initialize();
        
        // Set up the automation with specified parameters
        const tx = await automation.setAutomation(triggerHealthFactor, targetHealthFactor);
        
        return {
            automation: new ProtectionAutomation(connection, wallet, accountPubkey),
            result: `Protection automation created successfully with account ${accountPubkey.toString()}. Transaction: ${tx}`
        };
    } catch (error) {
        throw new Error(`Failed to create protection automation: ${error.message}`);
    }
}

// Export all actions
export default [
    setAutomationAction,
    borrowAction,
    repayAction,
    autoRepayAction,
] as Action[];
