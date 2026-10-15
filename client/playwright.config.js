import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:3002",
    headless: true,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command:
        "cd ../ && DATABASE_PATH=./data/users.db ADDR=:4000 JWT_SECRET=test-secret /tmp/docked-api",
      port: 4000,
      timeout: 10_000,
      reuseExistingServer: true,
    },
    {
      command: "cd ../server && DATA_DIR=../data JWT_SECRET=test-secret PORT=3001 node server.js",
      port: 3001,
      timeout: 10_000,
      reuseExistingServer: true,
    },
    {
      command: "npx vite --port 3002",
      port: 3002,
      timeout: 10_000,
      reuseExistingServer: true,
    },
  ],
});
