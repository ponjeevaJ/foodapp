import { defineConfig } from "@playwright/test";

const reuseExistingServer = !process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true
  },
  webServer: [
    {
      command: "npm start",
      url: "http://127.0.0.1:3000/api/suggest?q=",
      reuseExistingServer,
      timeout: 30000
    },
    {
      command: "npm run dev -- --host 127.0.0.1",
      url: "http://127.0.0.1:5173",
      reuseExistingServer,
      timeout: 30000
    }
  ]
});
