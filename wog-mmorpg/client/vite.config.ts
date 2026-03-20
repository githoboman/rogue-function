import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // Proxy WS to shard server in dev
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
