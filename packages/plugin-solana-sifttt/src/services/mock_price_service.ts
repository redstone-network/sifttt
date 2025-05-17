import { elizaLogger } from "@elizaos/core";

export class MockPriceService {
    private static instance: MockPriceService;
    private mockPrices: Map<string, number>;
    private lastUpdateTime: number;

    private constructor() {
        this.mockPrices = new Map();
        this.lastUpdateTime = Date.now();
        this.initializeMockPrices();
    }

    public static getInstance(): MockPriceService {
        if (!MockPriceService.instance) {
            MockPriceService.instance = new MockPriceService();
        }
        return MockPriceService.instance;
    }

    private initializeMockPrices() {
        // 初始化一些mock价格
        this.mockPrices.set("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 1.0); // USDC
        this.mockPrices.set("So11111111111111111111111111111111111111112", 100.0); // SOL
    }

    // 模拟价格波动
    private updateMockPrices() {
        const now = Date.now();
        if (now - this.lastUpdateTime < 1000) { // 每秒最多更新一次
            return;
        }

        this.mockPrices.forEach((price, token) => {
            // 随机波动 ±5%
            const change = (Math.random() - 0.5) * 0.1;
            const newPrice = price * (1 + change);
            this.mockPrices.set(token, newPrice);
        });

        this.lastUpdateTime = now;
        elizaLogger.log("Mock prices updated:", Object.fromEntries(this.mockPrices));
    }

    // 获取当前价格
    public getCurrentPrice(tokenAddress: string): number {
        this.updateMockPrices();
        const price = this.mockPrices.get(tokenAddress);
        if (price === undefined) {
            throw new Error(`No mock price available for token: ${tokenAddress}`);
        }
        return price;
    }

    // 设置mock价格(用于测试)
    public setMockPrice(tokenAddress: string, price: number) {
        this.mockPrices.set(tokenAddress, price);
        elizaLogger.log(`Mock price set for ${tokenAddress}: ${price}`);
    }
}

// 导出单例实例
export const mockPriceService = MockPriceService.getInstance();
