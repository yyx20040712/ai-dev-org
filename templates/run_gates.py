#!/usr/bin/env python3
"""门禁聚合入口（pnpm+py-gates 型骨架）——ai-dev-org init-defenses 生成。

探测 ruff/mypy/pytest 可用性逐 gate 执行；未安装=SKIP（骨架宽松模式）。
CI 投产设 DEFENSES_STRICT=1：SKIP 升级为 FAIL。
用法：python scripts/run_gates.py   （退出码：0=全过；1=有 FAIL）
"""
import os
import shutil
import subprocess
import sys

STRICT = os.environ.get("DEFENSES_STRICT") == "1"
GATES = [
    {"id": "ruff", "cmd": ["ruff", "check", "."], "hint": "pnpm add -D ruff 或 pipx install ruff"},
    {"id": "mypy", "cmd": ["mypy", "."], "hint": "pnpm add -D mypy 或 pipx install mypy"},
    {"id": "pytest", "cmd": ["pytest"], "hint": "pnpm add -D pytest"},
]

fails = 0
for g in GATES:
    exe = shutil.which(g["cmd"][0])
    if exe is None:
        print(f"SKIP {g['id']}（未安装）→ {g['hint']}" + ("（STRICT：视为 FAIL）" if STRICT else ""))
        if STRICT:
            fails += 1
        continue
    print(f"-- gate {g['id']}: {' '.join(g['cmd'])}")
    r = subprocess.run(g["cmd"])
    if r.returncode != 0:
        print(f"FAIL {g['id']}（exit={r.returncode}）", file=sys.stderr)
        fails += 1
    else:
        print(f"PASS {g['id']}")

mode = "strict" if STRICT else "宽松"
print(f"gates 汇总：{'PASS' if fails == 0 else f'FAIL ×{fails}'}（{mode}模式，缺失 gate {'阻断' if STRICT else '不阻断'}）")
sys.exit(0 if fails == 0 else 1)
