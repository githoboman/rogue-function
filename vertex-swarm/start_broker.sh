#!/usr/bin/env bash
# Start FoxMQ (Tashi Vertex BFT consensus broker) on Windows
# Run this first, then run: python wog_swarm.py
cd "$(dirname "$0")/foxmq-bin"
echo "Starting FoxMQ broker on 127.0.0.1:1883..."
./foxmq.exe run \
  --allow-anonymous-login \
  --mqtt-addr=127.0.0.1:1883 \
  --secret-key-file=foxmq.d/key_0.pem \
  foxmq.d/
