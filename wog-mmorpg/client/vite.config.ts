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
      // Proxy WS to shard server in dev
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
      // Proxy REST endpoints the Estate dashboard reads from
      "/properties": { target: "http://localhost:3000", changeOrigin: true },
      "/foxmq":      { target: "http://localhost:3000", changeOrigin: true },
      "/agent":      { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
