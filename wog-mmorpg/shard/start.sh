#!/bin/sh
# Start shard server in the background
pnpm exec tsx src/server.ts &
SHARD_PID=$!

# Wait for server to be ready
echo "Waiting for shard server to start..."
sleep 5

# Start batch agents
echo "Starting agent system..."
pnpm exec tsx src/batchAgents.ts &
AGENT_PID=$!

# If either process dies, kill both and exit
trap "kill $SHARD_PID $AGENT_PID 2>/dev/null; exit 0" SIGTERM SIGINT

wait -n
kill $SHARD_PID $AGENT_PID 2>/dev/null
exit 1
