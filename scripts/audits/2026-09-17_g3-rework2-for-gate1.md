# g3 门一微确认包（轮 2 微修——W1-r1 处方落地核对，禁访仓库）

你复审出 W1-r1（if(hostCfg) 闸 hf 未定义暴露面）并处方「补一行 else 跳过行」。回炉轮 2 已按处方落地：主控机器事实已定 readJson 缺席必抛 ENOENT（readFileSync 语义，readJson 内无 existsSync 守卫）→路径当前不可达，定性=纵深防御（evolve-b6 同族，报告已如实引用）。

## 待核对 hunk（--install 调用块，相对 cd2d751 diff 节选）

```diff
+      let hostCfg = null
+      try {
+        hostCfg = readHostConfig()
+      } catch (e) {
+        hf = { wrote: false, level: 'warn', line: `install-hostfacts——跳过：宿主配置装载失败（${e.message}）——手工路径=DEPLOY §3` }
+      }
+      if (hostCfg) hf = installHostFacts(oc.merged, hostCfg, oc.overPath)
+      // 回炉轮 2 R5（W1-r1，纵深防御——evolve-b6 同族）：readHostConfig 返
+      // falsy 的理论形态兜底（主控机器事实：实装 readJson 对缺席文件必抛
+      // ENOENT 走上行 catch，此路当前不可达——补 else 消 hf 未定义暴露面，
+      // 非修活缺陷）
+      else
+        hf = { wrote: false, level: 'warn', line: `install-hostfacts——跳过：宿主配置不可读/缺席（readHostConfig 返回 ${hostCfg === null ? 'null' : typeof hostCfg}——理论形态，实装缺席必抛 ENOENT 由装载失败行承接）——手工路径=DEPLOY §3` }
+    }
+    if (hf.level === 'FAIL') installFailCount++
+    console.log(hf.level === 'FAIL' ? `[FAIL] ${hf.line}` : `[install] ${hf.line}`)
+  }
+
+  // 自身装载错守卫（exit 3 族）：org-config 装载失败（检查主体消费 cfg——
+  // 回炉轮 1 R2 后移至 install 块后：坏覆盖件时 install 三动作先执行、③ 打印
+  // 干净跳过行，再到此处按装载错退 3，不再整场前置短路）
```

## 报告回炉轮 2 节全文

## 回炉轮 2（2026-09-17，门一复审 PASS B=0/W=1/N=3 后唯一 W）

**事实定性（一行）**：R5=W1-r1 属**纵深防御**（evolve-b6 同族）——主控已落
机器事实：实装 readJson 对缺席文件必抛 ENOENT（readFileSync 语义），故
readHostConfig 返 falsy 的路径**当前不可达**；本修=补 else 分支消除 hf 未定义
的**理论暴露面**，非修活缺陷。

**改动**：仅 `scripts/deploy-check.mjs`——install 块 `if (hostCfg)` 补 else
（hf=warn 跳过行，真因一行含返回值描述+「实装缺席必抛 ENOENT 由装载失败行
承接」注记）+自检向量 1 条（26→29→**30**；hostCfg=null 注入 installHostFacts：
不裸抛+不写+指引行，全别名入 unmatched——最小落法取注入式，非调用面重构）。

**红证**（变异注入=缺陷形态实录：readHostConfig 位临时注 null，现行结构无 else）：

```
$ node scripts/deploy-check.mjs --install；echo exit=$?
（install 三行正常打印后——）
file:///C:/…/scripts/deploy-check.mjs:465
    if (hf.level === 'FAIL') installFailCount++
           ^
TypeError: Cannot read properties of undefined (reading 'level')
                                   exit=1（裸堆栈——hf 未赋值暴露面）
```

**绿证**（同注入复验，修复后）：同款 null 注入下 ③ 打印干净跳过行、无堆栈：

```
[install] install-hostfacts——跳过：宿主配置不可读/缺席（readHostConfig 返回 null——理论形态，实装缺席必抛 ENOENT 由装载失败行承接）——手工路径=DEPLOY §3
```

（注入行已即撤——grep MUTATION 计 0；正常路径不受影响。）

**复跑实录（真退出码）**：

```
$ node scripts/deploy-check.mjs --self-test → self-test 全过（30 向量）  exit=0
$ node scripts/regression.mjs               → 8/8 过，SKIP ×1             exit=0
  PASS R8 log-triage:exit=0/全过=true/验收断言=true org-config:exit=0/全过=true deploy-check:exit=0/全过=true
```

**零触碰自查**：git status 与回炉轮 1 交付面完全一致（7 改+00 件+报告+主控/
门一 3 件）；本轮改动面仅上述 else 分支+1 向量，其余零触碰。

MODEL-SELF: ops-executor bound
LEDGER-CLAIM: EXECUTOR=model-field:ops-executor

## 主控亲验

deploy-check --self-test 30 向量 exit=0（+1=hostCfg=null 注入式）；regression 8/8 exit=0（R8 三脚本全过）。

产出：处方符合性一句话判定+新破坏扫描一句话+尾栏（FINDINGS/VERDICT）。
