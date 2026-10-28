import "dotenv/config";
import { defineConfig } from "@playwright/test";

// 直接使用已啟動的 http://localhost:3001，不啟動測試伺服器
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.js",
  timeout: 180_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3001",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "zh-TW",
  },
});
