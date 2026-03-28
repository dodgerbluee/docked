import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3002,
    proxy: {
      // Route GET /api/containers (with or without query string) to the Go backend.
      // The (\?.*)? allows query params like ?useNewCache=true to still match.
      // Sub-paths like /api/containers/data fall through to the Node.js catch-all below.
      "^/api/containers(\\?.*)?$": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "build",
    sourcemap: false,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (/react|react-dom|react-router-dom/.test(id)) return "vendor-react";
            if (/recharts/.test(id)) return "vendor-charts";
            if (/react-select|lucide-react/.test(id)) return "vendor-ui";
          }
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/setupTests.js",
    css: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary"],
    },
  },
});
