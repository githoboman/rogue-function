import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        game: resolve(__dirname, "game.html"),
      },
    },
  },
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
