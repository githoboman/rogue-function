import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        game: resolve(__dirname, "game.html"),
        estate: resolve(__dirname, "estate.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Shard server runs on PORT (see shard/.env, default 3001 in this setup).
      // Proxy WS + the REST endpoints the game/Estate dashboard read from.
      "/ws": {
        target: "ws://localhost:3001",
        ws: true,
      },
      "/properties": { target: "http://localhost:3001", changeOrigin: true },
      "/foxmq":      { target: "http://localhost:3001", changeOrigin: true },
      "/agent":      { target: "http://localhost:3001", changeOrigin: true },
      "/state":      { target: "http://localhost:3001", changeOrigin: true },
      "/zone":       { target: "http://localhost:3001", changeOrigin: true },
      "/ai":         { target: "http://localhost:3001", changeOrigin: true },
      "/health":     { target: "http://localhost:3001", changeOrigin: true },
    },
  },
});
