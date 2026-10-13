#!/usr/bin/env node
// glm-look.mjs — 设计岗图像通道外呼标准流程（双通道多模态看图：
//   --channel glm=GLM-5.3-Flash[缺省] / --channel ds=deepseek-flash——
//   2026-09-11 用户指示 ds 入列，双通道共担视觉任务）。
//
// 用法:
//   node scripts/glm-look.mjs --prompt <提示词文件.md> <图1.png> [图2.png …] [-o 报告.md] [--channel glm|ds]
//   node scripts/glm-look.mjs --list-sources        # 零 API 调用，列两通道源发现结果
//
// 输入:  提示词文件（判据/任务书——设计岗系统提示由调用方自带）+ 1~N 张
//        本地截图（png/jpg/jpeg/webp）
// 输出:  stdout=模型正文；-o 时同步落报告文件（含溯源头注释）；
//        scripts/model-routing-log.jsonl 追加 attempt/ok/fail 流水
//        （role_id=design-reviewer，channel=glm-look|ds-look——
//        ds-call-v2 同账本）
//
// 纪律（references/07 设计岗卡「外呼看图标准流程」条款）:
//   - max_tokens 起步 8000 且**禁低于 8000**：推理段（glm thinking/
//     ds reasoning）耗 completion 配额——低档实测全耗推理零正文输出
//     （2026-09-10 WaterPrint C 批采证实录）——**零正文+截断终态时
//     自动倍升重试**（8000→16000→32000，至多 3 轮），低档静默=假成功；
//   - key 零泄露（任何输出不含 apiKey）——代码级保障=scrub 脱敏，错误体/
//     错误串/流水全过 SCRUB_RE（v1.6 批 P0-B b：原仅口头声明）；
//   - 单次调用上限 20 分钟（AbortSignal.timeout=唯一超时源——对齐派发器
//     06 §5.7 传输纪律；v1.6 批 P0-B a：原 fetch 无超时可无限挂起）；
//     4xx（429 除外）立断不重试（对齐派发器 NO_RETRY；429/5xx 保留退避重试）；
//   - 传输层=node:http(s) 直连（evolve 批 b1，2026-09-16——镜像 ds-call-v2
//     v2.2.1 postJson：弃 global fetch，undici 内建 headers/body 300s 默认会在
//     非流式长推理期先掐；req 侧禁 setTimeout，不跟随 3xx，不设
//     accept-encoding；R10 结构断言+mock 双通道往返钉此面）；
//   - ok 流水行带 truncated 派生布尔（finish 白名单反转口径，词表=org-config
//     finish_vocab——闭残留册 glm-look-truncation-field）；
//   - 流水行 schema 对齐派发器 ctx 五字段（dispatcher_version/role_version/
//     role_sig/org_config_hash + attempt 序号；ok 行增 finish_class；fail 行
//     增 statusCode——selfiter 批 glm-look-schema 清偿，双写入者一套行契约，
//     R4 对 channel+dispatcher_version 双标记行按对齐 schema 校验）；
//   - 截断终态不因「有正文」豁免（selfiter 批 glm-look-truncation 清偿）：
//     finish=截断即倍升重试（无论正文有无）；3 轮后仍截断=报告照出但
//     exit 1（「截断的审计报告不算合格审计」——05 §4 判据速查）；
//   - argv 解析收编 org-config cliFlag 单源（缺值/重复/值形如 flag/等号形态/
//     未知 flag=用法错 fail-fast——selfiter 批 g3-glmlook-flags 清偿）；
//   - 视觉方向级决策仍留用户——本通道只产判读证据；
//   - 退出码经 process.exitCode 自然退出（Node 25 libuv 退出阶段
//     async.c 断言规避——HOST-node25 同族面，勿用 process.exit 急退）。
// 源发现: 宿主 config（~/.zcode/v2/config.json）提供端点与 key；通道的模型名/
//   端点甄别子串/偏好序=org-config `vision_channels` 分区（v1.6 批预裁 A——
//   供应商事实住 org-config，06 §0；独立分区不动 roles 注册表，07 §4
//   「会话内岗不动注册表」先例保持；2026-09-11 ds 通道识图实证可用）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { fileURLToPath } from "node:url";
import { loadOrgConfig, cliFlag, UsageError, cfgHash, withFileLock, parseSseText, collectAnthropicSse, collectOpenaiSse, readHostConfig } from "./org-config.mjs";

const DISPATCHER_VERSION = "glm-look/1.3.2"; // 自版本号（写入者身份——流水 ctx 对齐面）。1.3.2=vmware 迁移批 2026-10-13：宿主真源读取改 readHostConfig 双注册表合并（legacy config.json 缺席容错——新机纯装形态 ENOENT 崩点实测清偿）；env 重定向 mock 路径（R10 钩子）维持直读单件
let DEGRADED = false; // 降级运行位（宿主 provider null 条目——发现面部分可用，显式留痕 exit 5）

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url)); // 规范解析（percent-decode）——原 URL pathname 手拼在含空格/中文路径下必坏（v1.6 批 P0-B e）
const SKILL_ROOT = path.join(SCRIPT_DIR, "..");
// env 重定向钩子（evolve 批 b1 内部测试设施，R10 mock 往返用——缺省行为不变：
// 不设 env 时落点/配置与原硬编码完全一致；prod 路径禁依赖）
const ROUTING_LOG = path.join(process.env.GLM_LOOK_LOG_DIR || SCRIPT_DIR, "model-routing-log.jsonl");
const CONFIG = process.env.GLM_LOOK_HOST_CONFIG || path.join(os.homedir(), ".zcode", "v2", "config.json");
const MIN_MAX_TOKENS = 8000;
const CALL_TIMEOUT_MS = 20 * 60_000; // 单次调用上限=对齐派发器（06 §5.7）
// 通道甄别参数单源=org-config vision_channels（v1.6 批 P0-B d 预裁 A）；
// 通道未声明=无源返回（禁脚本兜底硬编码——06 §0）
// 装载惰性单例（evolve 批 b1：isMain guard 后 import 消费纯函数零副作用——
// R10 向量脚本 import splitEndpoint 不触配置装载）
let _orgCfgCache = null;
const orgCfg = () => { _orgCfgCache ??= loadOrgConfig(SKILL_ROOT).merged; return _orgCfgCache; };
const chCfg = (ch) => (orgCfg().vision_channels || {})[ch] || {}; // 回炉 W2：未命中通道兜底 {}（旧版恒 {}；discoverSources 解构不崩、走「通道未声明=无源」分支）
/** 脱敏（原受控复制自 ds-call-v2.mjs——源件已随派发器退役并物理删除
 * 〔2026-10-03 纯净化批〕，本件为该字面量唯一存活体；受控复制对账者 R9
 * 已同步删除——升格共享模块=未来分发重构时再裁，裁决档 W7 统一判据）。 */
const SCRUB_RE = /(Bearer\s+)?[A-Za-z0-9_-]{24,}/g // 日志脱敏：长 token 形态一律掩码（K-N2）
const scrub = (s) => String(s).replace(SCRUB_RE, '<redacted>')
/** 通道枚举（glm=anthropic 格式 / ds=OpenAI 格式 image_url——载荷与
 * 端点异构，纪律面共用）。 */
const CHANNELS = new Set(["glm", "ds"]);

/** URL 拆解为 node:http(s) request 选项三元组（纯函数，export 供 R10 向量）：
 * 端口缺省按协议补（http=80/https=443），path=pathname+search。
 * 传输层镜像源=ds-call-v2 v2.2.1 postJson（evolve 批 b1）。 */
export function splitEndpoint(url) {
  const u = new URL(url);
  return {
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port ? Number(u.port) : u.protocol === "http:" ? 80 : 443,
    path: u.pathname + u.search,
  };
}

/** POST 传输层=node:http(s) 直连（evolve 批 b1——镜像 ds-call-v2 v2.2.1：
 * 弃 global fetch，undici 内建 headers/body 300s 默认会在非流式长推理期
 * 先掐；signal=AbortSignal 唯一超时源（req 侧禁 setTimeout）；不跟随 3xx；
 * 不设 accept-encoding；res.on('error') 防响应中途断流挂起）。 */
function postJson(url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const ep = splitEndpoint(url);
    const lib = ep.protocol === "http:" ? httpRequest : httpsRequest;
    const req = lib(
      {
        hostname: ep.hostname,
        port: ep.port,
        path: ep.path,
        method: "POST",
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("error", reject);
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode,
            ok: res.statusCode >= 200 && res.statusCode < 300,
            text: async () => text,
            json: async () => JSON.parse(text),
          });
        });
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

function channelTag(channel) {
  return channel === "ds" ? "ds-look" : "glm-look";
}

let logWarned = false; // 流水写失败一次性留痕位（v2.0.1 修复批 L8——原 catch 完全静默=证据链无据可查且无人知情，对齐 ds-call-v2 makeSafeAppend 纪律）
function logEvent(event, fields) {
  const { channel, ...rest } = fields;
  // ctx 五字段对齐派发器行 schema（selfiter 批 glm-look-schema 清偿）：
  // role_version/role_sig=会话内岗诚实值（07 §4 设计岗卡，无 registry 档案——
  // sig=null 表「无签名面」而非缺字段；R4 按 !==undefined 判在场）
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    runId: rest.runId,
    event,
    role_id: "design-reviewer",
    role_version: "07 §4 设计岗卡（会话内岗无 registry 档）",
    role_sig: null,
    dispatcher_version: DISPATCHER_VERSION,
    org_config_hash: cfgHash(orgCfg()),
    channel: channelTag(channel),
    ...rest,
  });
  try {
    // 跨进程建议锁（selfiter B4：与 ds-call-v2 同流水多写入者行交错面）
    withFileLock(ROUTING_LOG + '.lock', () => { fs.appendFileSync(ROUTING_LOG, line + "\n"); });
  } catch (e) {
    if (!logWarned) { logWarned = true; console.error(`[log-warn] 流水写入失败（后续仅警告一次，不影响调用主流程）：${ROUTING_LOG}: ${e.message}`) }
  }
}

function discoverSources(channel) {
  const { model, endpoint_contains: endpointContains, prefer_hosts: preferHosts } = chCfg(channel);
  if (!model || !endpointContains) return [] // 通道未在 org-config vision_channels 声明=无源（禁脚本兜底）
  let cfg
  if (process.env.GLM_LOOK_HOST_CONFIG) {
    // env 重定向=子进程驱动/mock 路径（R10 回归钩子）：直读单件+BOM 剥离（v1.6 批 P2 原语义保持）
    cfg = JSON.parse(fs.readFileSync(CONFIG, "utf-8").replace(/^\uFEFF/, ""))
  } else {
    // 宿主真源：双注册表合并+单件缺席容错（org-config.readHostConfig 单点封装——glm-look 未随
    // 2026-10-03 kimi-third 双注册表批跟进的欠账，新机纯装形态（无 legacy config.json）ENOENT
    // 栈崩于 2026-10-13 VMware 迁移实测；双件全缺=降级零源 exit 5 留痕，非崩）
    try {
      cfg = readHostConfig()
    } catch (e) {
      console.error(`[degraded] 宿主注册表读取失败（${e.message}）——零源继续（漏检面=全部通道源），退出码 5`)
      DEGRADED = true
      return []
    }
  }
  const found = [];
  for (const [pid, prov] of Object.entries(cfg.provider || {})) {
    // null/非对象宿主条目守卫（selfiter 批 evolve-glmlook-150-null 清偿——M3 族
    // 第 4 消费点，同 b4 形态：降级行+跳过；该条目漏检面如实留痕 exit 5）
    if (!prov || typeof prov !== "object") {
      console.error(`[degraded] 宿主配置 provider 含 null/非对象条目（${pid}）——该条目跳过、其余源继续发现（漏检面=该条目端点/模型），退出码 5`);
      DEGRADED = true;
      continue;
    }
    const opts = prov.options || {};
    if (!opts.apiKey || !opts.baseURL) continue;
    const base = String(opts.baseURL).replace(/\/$/, "");
    const models = prov.models || {};
    const modelKey = Object.keys(models).find((k) => k === model);
    if (!modelKey) continue;
    if (!base.includes(endpointContains)) continue;
    const spec = models[modelKey];
    const realModel = spec && typeof spec === "object" && spec.name ? spec.name : modelKey;
    found.push({ pid, model: realModel, base, key: opts.apiKey });
  }
  if (Array.isArray(preferHosts) && preferHosts.length) {
    // 偏好序=prefer_hosts 数组序（命中靠前者优）；未命中段按 pid 字典序定序——
    // 勿依赖宿主 config 对象键序（RFC 8259 无保序保证，终审 W5）
    const rank = (s) => { const i = preferHosts.findIndex((h) => s.base.includes(h)); return i === -1 ? preferHosts.length : i }
    return found.sort((a, b) => rank(a) - rank(b) || a.pid.localeCompare(b.pid))
  }
  return found.sort((a, b) => a.pid.localeCompare(b.pid));
}

/** 响应归一（通道异构面收口）：texts/hasText/finish/usage 四元。 */
function normalizeResponse(resp, channel) {
  if (channel === "glm") {
    const texts = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text);
    return {
      texts,
      hasText: texts.some((t) => t),
      finish: resp.stop_reason,
      usage: resp.usage || {},
    };
  }
  const choice = (resp.choices || [{}])[0] || {};
  let content = (choice.message || {}).content;
  if (Array.isArray(content)) {
    content = content.map((c) => (typeof c === "string" ? c : c.text || "")).join("");
  }
  const texts = typeof content === "string" && content ? [content] : [];
  const usage = resp.usage || {};
  return {
    texts,
    hasText: texts.length > 0,
    finish: choice.finish_reason,
    usage: { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens },
  };
}

function usage() {
  console.error(`用法: node scripts/glm-look.mjs --prompt <提示词文件.md> <图1.png> [图2.png …] [-o 报告.md] [--channel glm|ds]
      node scripts/glm-look.mjs --list-sources
通道: glm（缺省，anthropic 格式）/ ds（OpenAI image_url 格式）——模型/端点甄别=org-config vision_channels（实配以 --list-sources 为准）
纪律: max_tokens 缺省 ${MIN_MAX_TOKENS} 禁降档（推理段耗额坑——低档=零正文假成功）`);
}

async function main() {
  const argv = process.argv.slice(2);
  const ORG_CFG = orgCfg(); // 配置单例（顶层惰性装载——isMain 后 import 零副作用）
  // finish_vocab 拒跑守卫（终审 W3：缺词表=配置错——同批 ds-call-v2/log-triage 已立此纪律，
  // 原可选链静默兜底致 completeFinishes 空集、truncated 恒 true 的静默假数据面）
  if (!ORG_CFG.finish_vocab?.complete?.length || !ORG_CFG.finish_vocab?.truncation?.length) {
    console.error("[config] org-config finish_vocab 缺 complete/truncation 词表（词表单源纪律 06 §0）——拒跑（exit 3）");
    return 3;
  }
  if (argv.includes("--list-sources")) {
    for (const ch of CHANNELS) {
      const sources = discoverSources(ch);
      console.log(`== channel=${ch}（${channelTag(ch)}）==`);
      if (sources.length === 0) {
        console.log("  (未发现可用源)");
        continue;
      }
      sources.forEach((s, i) =>
        console.log(`  ${i + 1}. ${s.pid} | ${s.model} | ${s.base}`));
    }
    return DEGRADED ? 5 : 0; // 降级运行=显式留痕不阻断（exit 5 语义族——06 §5.8 行 5 适用面本批扩至本件）
  }
  // argv 收编 org-config cliFlag 单源（selfiter 批 g3-glmlook-flags 清偿）：
  // 缺值/重复/值形如 flag/等号形态=用法错拒收；未知 flag fail-fast（原静默
  // 落入 images 由扩展名报错——错误归因面差）
  let promptFile = "";
  let outFile = "";
  let maxTokens = MIN_MAX_TOKENS;
  let channel = "glm";
  const VALUE_FLAGS = new Set(["--prompt", "-o", "--max-tokens", "--channel"]);
  try {
    promptFile = cliFlag(argv, "--prompt") || "";
    outFile = cliFlag(argv, "-o") || "";
    const mtArg = cliFlag(argv, "--max-tokens");
    if (mtArg !== null) maxTokens = Number(mtArg);
    const chArg = cliFlag(argv, "--channel");
    if (chArg !== null) {
      channel = String(chArg).toLowerCase();
      if (channel === "deepseek") channel = "ds";
    }
  } catch (e) {
    if (e instanceof UsageError) { console.error(`[用法错] ${e.message}`); return 1 }
    throw e
  }
  const images = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (VALUE_FLAGS.has(a)) { i += 1; continue } // 值段跳过
    if (a.startsWith("-") && a !== "-") {
      console.error(`[用法错] 未知 flag ${a}（本件 flag 面=--prompt/-o/--max-tokens/--channel/--list-sources）`);
      return 1;
    }
    images.push(a);
  }
  if (!CHANNELS.has(channel)) {
    console.error(`[glm-look] 未知通道 ${channel}（合法面 glm|ds）`);
    return 1; // 用法错=1（退出码总表=06 §5.8；2=派发器 exhaust 专用——v1.6 批统一）
  }
  if (!promptFile || images.length === 0) {
    usage();
    return 1;
  }
  if (!Number.isFinite(maxTokens) || maxTokens < MIN_MAX_TOKENS) {
    console.error(`[glm-look] max_tokens=${maxTokens} 低于 ${MIN_MAX_TOKENS} 下限——` +
      "推理段（glm thinking/ds reasoning）耗 completion 配额，低档实测零正文输出（假成功）。" +
      `如确需更多额度请 ≥${MIN_MAX_TOKENS}。`);
    return 1;
  }
  const sources = discoverSources(channel);
  if (sources.length === 0) {
    console.error(`[glm-look] channel=${channel} 未发现可用源——检查 ~/.zcode/v2/config.json`);
    return 3;
  }
  const src = sources[0];
  console.error(`[${channelTag(channel)}] source=${src.pid} model=${src.model} images=${images.length} max_tokens=${maxTokens}`);

  const mediaOf = (p) => {
    const ext = path.extname(p).toLowerCase();
    if (ext === ".png") return "image/png";
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    throw new Error(`不支持的图类型 ${ext}（png/jpg/jpeg/webp）: ${p}`);
  };
  const prompt = fs.readFileSync(promptFile, "utf-8");
  const imageEntries = images.map((p) => ({ p, media: mediaOf(p), b64: fs.readFileSync(p).toString("base64") }));
  // 通道载荷异构：glm=anthropic image 块（图先文后）/ ds=OpenAI
  // image_url data URL（文先图后——两族官方样例形态）
  const content =
    channel === "glm"
      ? [
          ...imageEntries.map((e) => ({
            type: "image",
            source: { type: "base64", media_type: e.media, data: e.b64 },
          })),
          { type: "text", text: prompt },
        ]
      : [
          { type: "text", text: prompt },
          ...imageEntries.map((e) => ({
            type: "image_url",
            image_url: { url: `data:${e.media};base64,${e.b64}` },
          })),
        ];

  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; // 后缀 8 字符（selfiter B4：对齐派发器，消同秒碰撞窗）
  const url = channel === "glm" ? `${src.base}/v1/messages` : `${src.base}/chat/completions`;
  const started = Date.now();
  // finish 词表集合（单源=org-config finish_vocab；终态判定与截断重试触发共用——
  // v2.0.1 修复批 L7：原重试触发词按通道硬编码，与「词表住 org-config」声明相悖）
  const completeFinishes = new Set(ORG_CFG.finish_vocab.complete);
  const truncFinishes = new Set(ORG_CFG.finish_vocab.truncation);

  let resp = null;
  let attemptTokens = maxTokens;
  let norm = null;
  let roundsRun = 0; // 实跑轮次（门一回炉 N2：零正文归因文案按真轮次——for 块级 attempt 循环外不可见）
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    roundsRun = attempt;
    // B5 流式位（selfiter 批）：org-config vision_channels.<ch>.stream=true 请求
    // SSE——首字节早达根治网关非流式窗口 504 族；响应侧 SSE/JSON 双形态
    const useStream = chCfg(channel).stream === true;
    const body = JSON.stringify({
      model: src.model,
      max_tokens: attemptTokens,
      messages: [{ role: "user", content }],
      ...(useStream ? (channel === "glm" ? { stream: true } : { stream: true, stream_options: { include_usage: true } }) : {}),
    });
    logEvent("attempt", { runId, channel, source: src.pid, model: src.model, attempt, images: images.length, promptBytes: body.length, maxTokens: attemptTokens });
    // 网络级瞬断重试（fetch failed/connection reset——实测偶发，5s 退避×2）；
    // 立断类=非 429 的 4xx（对齐派发器 NO_RETRY）与超时（TimeoutError——20min 已超长再试无意义）；
    // 429/5xx 保留退避重试（对齐派发器 RETRYABLE 语义——v1.6 批 P0-B c/W11）
    resp = null;
    for (let netTry = 1; netTry <= 3 && resp === null; netTry += 1) {
      try {
        const headers = { "content-type": "application/json" };
        if (channel === "glm") {
          headers["x-api-key"] = src.key;
          headers["anthropic-version"] = "2023-06-01";
        } else {
          headers["authorization"] = `Bearer ${src.key}`;
        }
        const r = await postJson(url, headers, body, CALL_TIMEOUT_MS);
        if (!r.ok) {
          const errBody = await r.text().catch(() => "");
          const err = new Error(`HTTP ${r.status}: ${scrub(errBody).slice(0, 300)}`);
          err.statusCode = r.status; // fail 行 statusCode 字段源（对齐派发器 P0-4 纪律：网络级失败=null 亦显式落字段）
          if (r.status >= 400 && r.status < 500 && r.status !== 429) err.noretry = true;
          throw err;
        }
        // B5 双形态：SSE 文本按通道形态收割（与非流式响应同构——normalizeResponse
        // 零改动）；非 SSE 应答=JSON 原语义（服务端忽略 stream 位的回退面）
        const rawText = await r.text();
        resp = /^(event:|data:)/m.test(rawText.slice(0, 200))
          ? (channel === "glm" ? collectAnthropicSse(parseSseText(rawText)) : collectOpenaiSse(parseSseText(rawText)))
          : JSON.parse(rawText);
      } catch (err) {
        const noretry = err.noretry === true || err.name === "TimeoutError" || err.name === "AbortError";
        if (netTry === 3 || noretry) {
          logEvent("fail", { runId, channel, source: src.pid, model: src.model, statusCode: err.statusCode ?? null, error: scrub(String(err)).slice(0, 200) });
          console.error(`[${channelTag(channel)}] 调用失败（${noretry ? "立断类（4xx 非 429/超时）" : "3 次网络重试后"}）: ${scrub(err.message)}`);
          return 1;
        }
        console.error(`[${channelTag(channel)}] 网络瞬断重试 ${netTry}/2（${scrub(err.message)}）——5s 退避`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        resp = null;
      }
    }
    norm = normalizeResponse(resp, channel);
    // 截断终态不因「有正文」豁免（selfiter 批 glm-look-truncation 清偿——原
    // hasText 即 break=截断有正文照当 ok 收下的假成功面）。回炉 W2 修正：
    // 重试条件=终态为截断（无论正文有无）——零正文且非截断=完整但空响应，
    // 立即收（重试不改变空产出，原语义保持；归因文案只对真截断打）。
    // 触发词=truncation 词表成员（修复批 L7——词表新增条目同获倍升重试机会）
    if (!truncFinishes.has(norm.finish)) break;
    if (attempt < 3) {
      console.error(`[${channelTag(channel)}] 第 ${attempt} 轮终态截断（finish=${norm.finish}${norm.hasText ? "，有正文仍不完整" : "，零正文"}）——倍升重试`);
      attemptTokens *= 2; // 倍升仅发生于确将重试时（修复批 L9：原循环尾无条件翻倍——末轮仍截断时流水 maxTokens 记未使用的翻倍值、重试提示虚高）
    }
  }
  if (norm === null) {
    console.error(`[${channelTag(channel)}] 无可用响应`);
    return 1;
  }
  const usageInfo = norm.usage;
  // finish_class+truncated 派生（镜像派发器 makeFinishClassifier 同口径：complete
  // 白名单正判，truncation/未知/无终态=非完整保守反转；词表集合已前置构建——修复批 L7）
  const finishClass = norm.finish == null ? "unknown" : completeFinishes.has(norm.finish) ? "complete" : truncFinishes.has(norm.finish) ? "truncation" : "unknown";
  const truncatedFlag = finishClass !== "complete";
  logEvent("ok", {
    runId, channel, source: src.pid, model: src.model,
    usage: { in: usageInfo.input_tokens, out: usageInfo.output_tokens },
    latencyMs: Date.now() - started, finish: norm.finish, finish_class: finishClass, truncated: truncatedFlag, images: images.length,
    maxTokens: attemptTokens,
  });
  if (!norm.hasText) {
    console.error(`[${channelTag(channel)}] 响应零正文（finish=${norm.finish}，实跑 ${roundsRun} 轮）——` +
      (truncFinishes.has(norm.finish)
        ? `截断族零正文（已倍升至 max_tokens=${attemptTokens}）：手动 --max-tokens ≥${attemptTokens * 2} 重试或减小图量。`
        : "完整终态但空产出：重试不改变产出（保守口径 exit 1，产出面人工处置）。"));
    return 1;
  }
  const out = norm.texts.join("\n\n");
  if (outFile) {
    const header = `<!-- ${channelTag(channel)} | source=${src.pid} model=${src.model} images=${images.join(", ")} | ` +
      `prompt_tokens=${usageInfo.input_tokens} completion_tokens=${usageInfo.output_tokens} ` +
      `finish=${norm.finish} | ${new Date().toISOString()} -->\n\n`;
    fs.writeFileSync(outFile, header + out + "\n", "utf-8");
    console.error(`[${channelTag(channel)}] 报告落盘 ${outFile}`);
  }
  console.log(out);
  // 截断终态不记成功（selfiter 批 glm-look-truncation 清偿）：报告照常输出供人工
  // 判读（证据保全），但机器面 exit 1——「截断的审计报告不算合格审计」（05 §4）
  if (truncatedFlag) {
    console.error(`[${channelTag(channel)}] finish=${norm.finish} 非完整终态（finish_class=${finishClass}/truncated=true 已落流水）——` +
      `3 轮倍升后仍截断：报告已输出仅供人工判读，机器面不得记成功（exit 1）。`);
    return 1;
  }
  return DEGRADED ? 5 : 0;
}

// isMain guard（evolve 批 b1，范式=org-config.mjs:124-126）：import 消费纯函数
// （splitEndpoint，R10 向量）时零副作用；CLI 体仅在直接执行时跑。
const isMain =
  process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  process.exitCode = await main(); // 自然退出保持（Node 25 libuv 退出面——禁 process.exit 急退）
}
