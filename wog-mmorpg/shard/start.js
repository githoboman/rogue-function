/**
 * start.js — Launches shard server + batch agents in one process
 * Used in Docker to run both services in a single container.
 */
const { spawn } = require("child_process");
const http = require("http");

const PORT = process.env.PORT || "3000";

// 1. Start shard server
console.log("Starting shard server...");
const shard = spawn("node", ["node_modules/tsx/dist/cli.mjs", "src/server.ts"], {
  stdio: "inherit",
  env: process.env,
});

// 2. Wait for server to be healthy, then start agents
function checkHealth(retries) {
  if (retries <= 0) {
    console.error("Shard failed to start after 60s — starting agents anyway");
    startAgents();
    return;
  }

  const req = http.get(`http://127.0.0.1:${PORT}/health`, (res) => {
    if (res.statusCode === 200) {
      console.log("Shard is ready! Starting agents...");
      startAgents();
    } else {
      setTimeout(() => checkHealth(retries - 1), 2000);
    }
  });

  req.on("error", () => {
    setTimeout(() => checkHealth(retries - 1), 2000);
  });

  req.setTimeout(2000, () => {
    req.destroy();
    setTimeout(() => checkHealth(retries - 1), 2000);
  });
}

function startAgents() {
  const agents = spawn("node", ["node_modules/tsx/dist/cli.mjs", "src/batchAgents.ts"], {
    stdio: "inherit",
    env: process.env,
  });

  agents.on("exit", (code) => {
    console.error(`Agent process exited with code ${code}`);
    process.exit(code || 1);
  });
}

shard.on("exit", (code) => {
  console.error(`Shard process exited with code ${code}`);
  process.exit(code || 1);
});

// Start health polling after 3s (give server time to begin binding)
setTimeout(() => checkHealth(30), 3000);
