#!/usr/bin/env bash
# ai-dev-org 面板启动器（入仓参数化版）：面板服务不在跑则后台拉起，然后打开浏览器。
# 端口=ORG_PANEL_PORT（默认 8787）；项目仓卡=ORG_PANEL_PROJECT=<项目仓绝对路径>（可选）。
PORT="${ORG_PANEL_PORT:-8787}"
URL="http://127.0.0.1:${PORT}"
DIR="$(cd "$(dirname "$0")" && pwd)"
if ! curl -s -m 1 "$URL/api/ping" >/dev/null 2>&1; then
  nohup node "$DIR/server.mjs" >>/tmp/ai-dev-org-panel.log 2>&1 &
  for _ in $(seq 1 30); do
    curl -s -m 1 "$URL/api/ping" >/dev/null 2>&1 && break
    sleep 0.3
  done
fi
xdg-open "$URL" >/dev/null 2>&1 || true
