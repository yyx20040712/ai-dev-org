#!/usr/bin/env bash
# 门禁聚合入口（generic 兜底型）——ai-dev-org init-defenses 生成。
# 非 npm/pnpm 栈：把本项目 gate 逐条写进 GATES 数组（命令须非零退出即红）。
# 骨架态=零 gate 可跑；投产后空 gate 视为 FAIL（防「入口存在但永不拦」）。
set -u
GATES=()
strict="${DEFENSES_STRICT:-0}"

fails=0
if [ "${#GATES[@]}" -eq 0 ]; then
  echo "SKIP 零 gate（骨架态）——把本项目检查命令填入 GATES 数组后投产"
  [ "$strict" = "1" ] && { echo "FAIL STRICT 模式：零 gate 不放行"; exit 1; }
  exit 0
fi
for g in "${GATES[@]}"; do
  echo "-- gate: $g"
  if bash -c "$g"; then echo "PASS $g"; else echo "FAIL $g"; fails=$((fails+1)); fi
done
echo "verify 汇总：$([ $fails -eq 0 ] && echo PASS || echo "FAIL ×$fails")"
exit $([ $fails -eq 0 ] && echo 0 || echo 1)
