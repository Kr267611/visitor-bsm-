#!/usr/bin/env bash
# Docker ke bina Windows par development ke liye Redis. Sirf local use, production mein Render Key Value.
set -euo pipefail
mkdir -p .tools/redis
curl -fsSL -o .tools/redis.zip https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip
powershell -NoProfile -Command "Expand-Archive -Force '.tools/redis.zip' '.tools/redis'"
rm .tools/redis.zip
