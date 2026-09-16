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
//   - key 零泄露（任何输出不含 apiKey）；
//   - 视觉方向级决策仍留用户——本通道只产判读证据；
//   - 退出码经 process.exitCode 自然退出（Node 25 libuv 退出阶段
//     async.c 断言规避——HOST-node25 同族面，勿用 process.exit 急退）。
// 源发现: 宿主 config（~/.zcode/v2/config.json）——glm 通道扫含
//   GLM-5.3-Flash 且带 key 的 anthropic 端点（偏好序=open.bigmodel.cn
//   直连 → z.ai/zcode plan → 其余）；ds 通道扫含 deepseek-flash 且带
//   key 的 deepseek 端点（2026-09-11 识图实证：acceptance 弹窗截图
//   标题/按钮文案准确读出）。命中即用（与 ds_review.py 同精神，
//   不入 org-config——会话内岗不动注册表先例）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ROUTING_LOG = path.join(SCRIPT_DIR, "model-routing-log.jsonl");
const CONFIG = path.join(os.homedir(), ".zcode", "v2", "config.json");
const MODEL = "GLM-5.3-Flash";
const DS_MODEL = "deepseek-flash";
const MIN_MAX_TOKENS = 8000;
/** 通道枚举（glm=anthropic 格式 / ds=OpenAI 格式 image_url——载荷与
 * 端点异构，纪律面共用）。 */
const CHANNELS = new Set(["glm", "ds"]);

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
  const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf-8"));
  const found = [];
  for (const [pid, prov] of Object.entries(cfg.provider || {})) {
    const opts = prov.options || {};
    if (!opts.apiKey || !opts.baseURL) continue;
    const base = String(opts.baseURL).replace(/\/$/, "");
    const models = prov.models || {};
    if (channel === "glm") {
      const modelKey = Object.keys(models).find((k) => k === MODEL);
      if (!modelKey) continue;
      const spec = models[modelKey];
      const realModel = spec && typeof spec === "object" && spec.name ? spec.name : modelKey;
      if (!/\/anthropic\/?$/.test(base) && !base.includes("/anthropic")) continue;
      found.push({ pid, model: realModel, base, key: opts.apiKey });
    } else {
      const modelKey = Object.keys(models).find((k) => k === DS_MODEL);
      if (!modelKey) continue;
      if (!base.includes("deepseek")) continue;
      const spec = models[modelKey];
      const realModel = spec && typeof spec === "object" && spec.name ? spec.name : modelKey;
      found.push({ pid, model: realModel, base, key: opts.apiKey });
    }
  }
  if (channel === "glm") {
    // 偏好序：bigmodel 直连 > z.ai/zcode plan > 其余；各档内 config 序
    const rank = (s) =>
      s.base.includes("open.bigmodel.cn") ? 0 :
      s.base.includes("z.ai") || s.base.includes("zcode") ? 1 : 2;
    return found.sort((a, b) => rank(a) - rank(b));
  }
  return found; // ds 单源族——config 序即偏好序
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
通道: glm=GLM-5.3-Flash（缺省，anthropic 格式）/ ds=deepseek-flash（OpenAI image_url 格式）
纪律: max_tokens 缺省 ${MIN_MAX_TOKENS} 禁降档（推理段耗额坑——低档=零正文假成功）`);
}

async function main() {
  const argv = process.argv.slice(2);
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
    return 2;
  }
  if (!promptFile || images.length === 0) {
    usage();
    return 2;
  }
  if (!Number.isFinite(maxTokens) || maxTokens < MIN_MAX_TOKENS) {
    console.error(`[glm-look] max_tokens=${maxTokens} 低于 ${MIN_MAX_TOKENS} 下限——` +
      "推理段（glm thinking/ds reasoning）耗 completion 配额，低档实测零正文输出（假成功）。" +
      `如确需更多额度请 ≥${MIN_MAX_TOKENS}。`);
    return 2;
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
    // 网络级瞬断重试（fetch failed/connection reset——实测偶发，5s 退避×2）
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
        const r = await fetch(url, { method: "POST", headers, body });
        resp = await r.json();
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(resp).slice(0, 300)}`);
      } catch (err) {
        if (netTry === 3) {
          logEvent("fail", { runId, channel, source: src.pid, model: src.model, error: String(err).slice(0, 200) });
          console.error(`[${channelTag(channel)}] 调用失败（3 次网络重试后）: ${err.message}`);
          return 1;
        }
        console.error(`[${channelTag(channel)}] 网络瞬断重试 ${netTry}/2（${err.message}）——5s 退避`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        resp = null;
      }
    }
    if (resp === null) continue;
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
  logEvent("ok", {
    runId, channel, source: src.pid, model: src.model,
    usage: { in: usageInfo.input_tokens, out: usageInfo.output_tokens },
    latencyMs: Date.now() - started, finish: norm.finish, images: images.length,
    maxTokens: attemptTokens,
  });
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

process.exitCode = await main();
