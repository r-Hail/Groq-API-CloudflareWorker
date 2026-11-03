// Groq API Cloudflare Worker 转发代理 —— 多 Key 轮询版
// 用法：部署后，Base URL 填 https://你的域名/v1
// Key 填 gsk_ 开头的真 Key（直连模式）或随便填（启用下方 Key 池轮询）
//
// 特性：
//   1. 支持多个 Groq Key 轮询（round-robin），分摊免费额度
//   2. 请求遇到 429（限额）/ 401 / 403 时自动换下一个 Key 重试
//   3. 客户端带 gsk_ 开头 Key 时优先用客户端的（直连模式，池不消耗）
//   4. 纯转发，支持流式 SSE、function calling、多模态

// ============ 多 Key 配置 ============
// 在下方填入你的 Groq Key（gsk_ 开头），每行一个，去掉行首 // 注释
// 也可以不在这里填，改用环境变量 GROQ_API_KEYS（逗号分隔），环境变量优先级更高
const GROQ_KEYS = [
  // "gsk_你的第1个Key",
  // "gsk_你的第2个Key",
  // "gsk_你的第3个Key",
];

const MAX_RETRIES = 3; // 遇到 429/401/403 时最多换 Key 重试的次数（不含首次）

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// 轮询游标（同一 Worker 实例内递增；实例重启后归零，不影响正确性）
let rr = 0;

export default {
  async fetch(request, env) {
    // 浏览器预检直接放行
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    // 根路径：健康检查（只显示 Key 数量，不泄露 Key 本身）
    if (url.pathname === "/" || url.pathname === "") {
      const pool = loadPool(env);
      return new Response(
        "Groq proxy (multi-key) OK. Keys loaded: " + pool.length +
        ". Use base URL: " + url.origin + "/v1\n",
        { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } }
      );
    }

    // /v1/xxx -> /openai/v1/xxx（Groq 的 OpenAI 兼容端点前缀是 /openai/v1）
    const path = url.pathname.replace(/^\/v1(?=\/|$)/, "/openai/v1");
    const upstreamURL = "https://api.groq.com" + path + url.search;

    // ============ 确定本轮可用的 Key 序列 ============
    const pool = loadPool(env);

    const auth = request.headers.get("Authorization") || "";
    const clientKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

    let keysToTry = [];
    if (clientKey.startsWith("gsk_")) {
      // 客户端自带有效格式的 Key：直连模式，优先用客户端的
      keysToTry = [clientKey];
    } else if (pool.length > 0) {
      // 从轮询游标开始，依次取出最多 MAX_RETRIES+1 个 Key
      const n = Math.min(pool.length, MAX_RETRIES + 1);
      for (let i = 0; i < n; i++) keysToTry.push(pool[(rr + i) % pool.length]);
    } else {
      // 没有任何 Key：原样透传，让 Groq 返回 401 提示
      keysToTry = [clientKey || null];
    }

    // 缓冲请求体（重试时需要复用；LLM API 请求体都不大，缓冲无压力）
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const bodyText = hasBody ? await request.text() : undefined;

    // ============ 依次尝试，失败自动换 Key ============
    let resp = null;
    let usedIndex = 0;
    for (let i = 0; i < keysToTry.length; i++) {
      const headers = new Headers(request.headers);
      headers.delete("host");
      headers.delete("cf-connecting-ip");
      headers.delete("cf-ipcountry");
      headers.delete("cf-ray");
      headers.delete("x-forwarded-for");
      headers.delete("x-forwarded-proto");
      headers.delete("x-real-ip");
      // Worker fetch 默认无 User-Agent，部分 API 对此直接 403，伪装成浏览器 UA
      headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
      headers.set("Accept", "application/json");
      if (keysToTry[i]) headers.set("Authorization", "Bearer " + keysToTry[i]);
      else headers.delete("Authorization");

      resp = await fetch(upstreamURL, {
        method: request.method,
        headers,
        body: hasBody ? bodyText : undefined,
        // @ts-ignore - 流式转发所需
        duplex: "half",
      });
      usedIndex = i;

      // 成功，或已没有可换的 Key → 结束
      if (![429, 401, 403].includes(resp.status) || i === keysToTry.length - 1) break;
      // 429/401/403 → 换下一个 Key 重试
    }

    // 推进轮询游标（按本次实际消耗的 Key 数推进）
    if (pool.length > 0 && !clientKey.startsWith("gsk_")) {
      rr = (rr + usedIndex + 1) % pool.length;
    }

    // ============ 响应处理：透传 + CORS ============
    const outHeaders = new Headers(resp.headers);
    Object.entries(CORS).forEach(([k, v]) => outHeaders.set(k, v));
    outHeaders.delete("content-encoding");
    outHeaders.delete("content-length");
    outHeaders.delete("transfer-encoding");
    // 重试成功的场景：提示客户端实际用了第几个 Key（1 开始），便于排查
    if (usedIndex > 0) outHeaders.set("X-Proxy-Key-Slot", String(usedIndex + 1));

    return new Response(resp.body, { status: resp.status, headers: outHeaders });
  },
};

// 读取 Key 池：环境变量 GROQ_API_KEYS（逗号分隔）优先，其次代码内 GROQ_KEYS
function loadPool(env) {
  const fromEnv = env && env.GROQ_API_KEYS
    ? String(env.GROQ_API_KEYS).split(",").map(s => s.trim()).filter(Boolean)
    : [];
  const keys = fromEnv.length > 0 ? fromEnv : GROQ_KEYS;
  return keys.filter(k => typeof k === "string" && k.startsWith("gsk_"));
}
