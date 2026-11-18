#!/usr/bin/env bash
# DevTroupe 面板启动器：服务未运行则后台拉起，确认就绪后打开页面。
set -u

PORT="${TROUPE_PANEL_PORT:-8787}"
DESIGN="${TROUPE_PANEL_DESIGN:-editorial}"
if [[ $# -gt 0 ]]; then
  if [[ $# -ne 2 || "$1" != "--design" ]]; then
    printf '用法：%s [--design editorial|instrument|blueprint]\n' "$0" >&2
    exit 1
  fi
  DESIGN="$2"
fi
case "$DESIGN" in
  editorial|instrument|blueprint) ;;
  *)
    printf 'DevTroupe 面板风格无效：%s（可选 editorial、instrument、blueprint）\n' "$DESIGN" >&2
    exit 1
    ;;
esac
BASE_URL="http://127.0.0.1:${PORT}"
URL="$BASE_URL"
if [[ "$DESIGN" != "editorial" ]]; then
  URL="${BASE_URL}/?design=${DESIGN}"
fi
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="${TROUPE_PANEL_LOG:-${TMPDIR:-/tmp}/dev-troupe-panel.log}"
NODE="${TROUPE_NODE:-node}"

for tool in curl grep nohup; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'DevTroupe 面板启动器缺少依赖：%s\n' "$tool" >&2
    exit 1
  fi
done
if ! command -v "$NODE" >/dev/null 2>&1; then
  printf 'DevTroupe 面板启动器找不到 Node：%s\n' "$NODE" >&2
  exit 1
fi

if [[ -n "${TROUPE_OPEN:-}" ]]; then
  OPENER="$TROUPE_OPEN"
elif command -v xdg-open >/dev/null 2>&1; then
  OPENER="xdg-open"
elif command -v open >/dev/null 2>&1; then
  OPENER="open"
else
  printf 'DevTroupe 面板启动器找不到浏览器打开器（xdg-open 或 open）\n' >&2
  exit 1
fi
if ! command -v "$OPENER" >/dev/null 2>&1; then
  printf 'DevTroupe 面板启动器找不到浏览器打开器：%s\n' "$OPENER" >&2
  exit 1
fi

panel_ready() {
  curl -fsS -m 1 "$BASE_URL/" 2>/dev/null | grep -q 'data-zcode-design'
}

if ! panel_ready; then
  nohup "$NODE" "$DIR/../bin/troupe.mjs" panel --port "$PORT" >>"$LOG" 2>&1 &
  for ((attempt = 0; attempt < 30; attempt += 1)); do
    panel_ready && break
    sleep 0.3
  done
fi

if ! panel_ready; then
  printf 'DevTroupe 面板未能启动，请检查日志：%s\n' "$LOG" >&2
  exit 1
fi

if ! "$OPENER" "$URL" >/dev/null 2>&1; then
  printf 'DevTroupe 面板已运行，但无法打开浏览器：%s\n' "$URL" >&2
  exit 1
fi
