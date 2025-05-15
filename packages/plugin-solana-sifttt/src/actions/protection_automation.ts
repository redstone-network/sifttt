import { PublicKey, Connection, Keypair, Transaction } from '@solana/web3.js';
import { Program, AnchorProvider, web3, BN } from '@project-serum/anchor';
import { IDL } from '../idl/sifttt';
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

// Contract program ID - should match the ID in the contract
const PROGRAM_ID = new PublicKey('BU5JMEZ6mwqjSBMWTrh2NF96SMHdjz5JU3nk526LjPdA');

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

/**
 * Protection Automation class for interacting with the SIFTTT contract
 * Provides methods to set up and manage health factor protection
 */
export class ProtectionAutomation {
  private program: Program;
  private connection: Connection;
  private wallet: any;
  private accountPubkey: PublicKey;

  /**
   * Constructor initializes the connection to the contract
   * @param connection - Solana connection
   * @param wallet - User's wallet
   * @param accountPubkey - Public key of the account state to manage
   */
  constructor(connection: Connection, wallet: any, accountPubkey: PublicKey) {
    this.connection = connection;
    this.wallet = wallet;
    this.accountPubkey = accountPubkey;

    // Create an Anchor provider
    const provider = new AnchorProvider(
      connection,
      wallet,
      { commitment: 'processed' }
    );

    // Initialize the program
    this.program = new Program(IDL, PROGRAM_ID, provider);
  }

  /**
   * Create a new account and initialize it
   * @returns Public key of the new account
   */
  async initialize(): Promise<PublicKey> {
    const newAccount = Keypair.generate();
    await this.program.rpc.initialize({
      accounts: {
        account: newAccount.publicKey,
        user: this.wallet.publicKey,
        systemProgram: web3.SystemProgram.programId,
      },
      signers: [newAccount],
    });
    
    this.accountPubkey = newAccount.publicKey;
    return newAccount.publicKey;
  }

  /**
   * Set automation parameters for protection
   * @param triggerHealthFactor - The health factor level that triggers automation
   * @param targetHealthFactor - The desired health factor to restore to
   * @returns Transaction signature
   */
  async setAutomation(triggerHealthFactor: number, targetHealthFactor: number): Promise<string> {
    elizaLogger.log(`Setting automation: trigger=${triggerHealthFactor}, target=${targetHealthFactor}`);
    const tx = await this.program.rpc.setAutomation(
      new BN(triggerHealthFactor),
      new BN(targetHealthFactor),
      {
        accounts: {
          account: this.accountPubkey,
          user: this.wallet.publicKey,
        },
      }
    );
    
    return tx;
  }

  /**
   * Execute borrow operation (decreases health factor)
   * @returns Transaction signature
   */
  async borrow(): Promise<string> {
    elizaLogger.log("Executing borrow operation");
    const tx = await this.program.rpc.borrow({
      accounts: {
        account: this.accountPubkey,
        user: this.wallet.publicKey,
      },
    });
    
    return tx;
  }

  /**
   * Execute repay operation (increases health factor)
   * @returns Transaction signature
   */
  async repay(): Promise<string> {
    elizaLogger.log("Executing repay operation");
    const tx = await this.program.rpc.repay({
      accounts: {
        account: this.accountPubkey,
        user: this.wallet.publicKey,
      },
    });
    
    return tx;
  }

  /**
   * Trigger auto-repay to restore health factor
   * @returns Transaction signature
   */
  async autoRepay(): Promise<string> {
    elizaLogger.log("Executing auto-repay operation");
    const tx = await this.program.rpc.autoRepay({
      accounts: {
        account: this.accountPubkey,
        user: this.wallet.publicKey,
      },
    });
    
    return tx;
  }

  /**
   * Get current account state including health factor
   * @returns Account state data
   */
  async getAccountState(): Promise<any> {
    const accountInfo = await this.program.account.accountState.fetch(this.accountPubkey);
    return {
      healthFactor: accountInfo.healthFactor.toNumber(),
      triggerHealthFactor: accountInfo.triggerHealthFactor.toNumber(),
      targetHealthFactor: accountInfo.targetHealthFactor.toNumber(),
      automationEnabled: accountInfo.automationEnabled,
    };
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
