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
import { loadOrgConfig } from "./org-config.mjs";

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
/** 脱敏（受控复制自 ds-call-v2.mjs——A3 受控双源：字面量由 regression R9
 * 对账钉同步；升格共享模块=未来分发重构时再裁，裁决档 W7 统一判据）。 */
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

function logEvent(event, fields) {
  const { channel, ...rest } = fields;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    runId: rest.runId,
    event,
    role_id: "design-reviewer",
    channel: channelTag(channel),
    ...rest,
  });
  try {
    fs.appendFileSync(ROUTING_LOG, line + "\n");
  } catch {
    /* 流水失败不阻断主流程（只读证据链尽力而为） */
  }
}

function discoverSources(channel) {
  const { model, endpoint_contains: endpointContains, prefer_hosts: preferHosts } = chCfg(channel);
  if (!model || !endpointContains) return [] // 通道未在 org-config vision_channels 声明=无源（禁脚本兜底）
  const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf-8").replace(/^\uFEFF/, "")); // BOM 剥离（对齐 org-config.readJson——v1.6 批 P2）
  const found = [];
  for (const [pid, prov] of Object.entries(cfg.provider || {})) {
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
    return 0;
  }
  let promptFile = "";
  let outFile = "";
  let maxTokens = MIN_MAX_TOKENS;
  let channel = "glm";
  const images = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--prompt") promptFile = argv[++i];
    else if (a === "-o") outFile = argv[++i];
    else if (a === "--max-tokens") maxTokens = Number(argv[++i]);
    else if (a === "--channel") {
      channel = String(argv[++i] || "").toLowerCase();
      if (channel === "deepseek") channel = "ds";
    } else images.push(a);
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

  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const url = channel === "glm" ? `${src.base}/v1/messages` : `${src.base}/chat/completions`;
  const started = Date.now();

  let resp = null;
  let attemptTokens = maxTokens;
  let norm = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const body = JSON.stringify({
      model: src.model,
      max_tokens: attemptTokens,
      messages: [{ role: "user", content }],
    });
    logEvent("attempt", { runId, channel, source: src.pid, model: src.model, images: images.length, promptBytes: body.length, maxTokens: attemptTokens });
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
          if (r.status >= 400 && r.status < 500 && r.status !== 429) err.noretry = true;
          throw err;
        }
        resp = await r.json();
      } catch (err) {
        const noretry = err.noretry === true || err.name === "TimeoutError" || err.name === "AbortError";
        if (netTry === 3 || noretry) {
          logEvent("fail", { runId, channel, source: src.pid, model: src.model, error: scrub(String(err)).slice(0, 200) });
          console.error(`[${channelTag(channel)}] 调用失败（${noretry ? "立断类（4xx 非 429/超时）" : "3 次网络重试后"}）: ${scrub(err.message)}`);
          return 1;
        }
        console.error(`[${channelTag(channel)}] 网络瞬断重试 ${netTry}/2（${scrub(err.message)}）——5s 退避`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        resp = null;
      }
    }
    norm = normalizeResponse(resp, channel);
    const truncFlag = channel === "glm" ? "max_tokens" : "length";
    if (norm.hasText || norm.finish !== truncFlag) break;
    console.error(`[${channelTag(channel)}] 第 ${attempt} 轮推理段耗尽配额（max_tokens=${attemptTokens} 零正文）——倍升重试`);
    attemptTokens *= 2;
  }
  if (norm === null) {
    console.error(`[${channelTag(channel)}] 无可用响应`);
    return 1;
  }
  const usageInfo = norm.usage;
  // truncated 派生布尔（finish 白名单反转——仅 complete 词表命中=完整，其余含未知=截断；
  // 词表单源=org-config finish_vocab，闭残留册 glm-look-truncation-field）
  const completeFinishes = new Set(ORG_CFG.finish_vocab.complete);
  const truncatedFlag = !completeFinishes.has(norm.finish);
  logEvent("ok", {
    runId, channel, source: src.pid, model: src.model,
    usage: { in: usageInfo.input_tokens, out: usageInfo.output_tokens },
    latencyMs: Date.now() - started, finish: norm.finish, truncated: truncatedFlag, images: images.length,
    maxTokens: attemptTokens,
  });
  if (truncatedFlag) console.error(`[${channelTag(channel)}] 注意：finish=${norm.finish} 非完整终态（truncated=true 已落流水）——报告可能不完整`);
  if (!norm.hasText) {
    console.error(`[${channelTag(channel)}] 响应零正文（finish=${norm.finish}）——` +
      `推理段耗尽配额面：3 轮倍升后仍零正文，手动 --max-tokens ≥${attemptTokens} 重试或减小图量。`);
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
  return 0;
}

// isMain guard（evolve 批 b1，范式=org-config.mjs:124-126）：import 消费纯函数
// （splitEndpoint，R10 向量）时零副作用；CLI 体仅在直接执行时跑。
const isMain =
  process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  process.exitCode = await main(); // 自然退出保持（Node 25 libuv 退出面——禁 process.exit 急退）
}
