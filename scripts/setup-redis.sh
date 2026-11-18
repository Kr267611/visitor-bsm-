#!/usr/bin/env bash
# Redis for Windows development without Docker. Local use only; production uses Render Key Value.
set -euo pipefail
mkdir -p .tools/redis
curl -fsSL -o .tools/redis.zip https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip
powershell -NoProfile -Command "Expand-Archive -Force '.tools/redis.zip' '.tools/redis'"
rm .tools/redis.zip
