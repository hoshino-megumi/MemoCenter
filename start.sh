#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "[1/2] 安装依赖到当前目录..."
  npm install --no-audit --no-fund
fi

if [ ! -f dist/index.html ]; then
  echo "[2/2] 构建前端..."
  npm run build
fi

echo "备忘中心启动中... http://127.0.0.1:5178"
node server/index.mjs
