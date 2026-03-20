#!/bin/sh
# Start shard server in the background
echo "Starting shard server..."
pnpm exec tsx src/server.ts &
SHARD_PID=$!

# Wait for server to be ready (poll health endpoint)
echo "Waiting for shard to be ready..."
for i in $(seq 1 30); do
  if wget -q -O /dev/null http://localhost:${PORT:-3000}/health 2>/dev/null; then
    echo "Shard is ready!"
    break
  fi
  sleep 2
done

# Start batch agents
echo "Starting agent system..."
pnpm exec tsx src/batchAgents.ts &
AGENT_PID=$!

# If either process dies, kill both and exit
trap "kill $SHARD_PID $AGENT_PID 2>/dev/null; exit 0" SIGTERM SIGINT

# Wait for either process to exit
wait $SHARD_PID $AGENT_PID
kill $SHARD_PID $AGENT_PID 2>/dev/null
exit 1
