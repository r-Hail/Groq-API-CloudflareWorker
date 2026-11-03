// Groq API Cloudflare Worker 纯转发代理
// 用法：部署后，Base URL 填 https://你的域名/v1 ，API Key 填 Groq 的 gsk_ 开头 Key
// 原理：/v1/xxx  ->  https://api.groq.com/openai/v1/xxx  （原样转发请求和响应，支持流式）

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export default {
  async fetch(request) {
    // 浏览器预检直接放行
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    // /v1/xxx -> /openai/v1/xxx（Groq 的 OpenAI 兼容端点前缀是 /openai/v1）
    let path = url.pathname;
    if (path === "/" || path === "") {
      return new Response("Groq proxy OK. Use base URL: " + url.origin + "/v1\n", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS },
      });
    }
    path = path.replace(/^\/v1(?=\/|$)/, "/openai/v1");

    const upstreamURL = "https://api.groq.com" + path + url.search;

    // 原样转发请求头（Authorization 透传给 Groq）
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ipcountry");
    headers.delete("cf-ray");
    headers.delete("x-forwarded-for");
    headers.delete("x-forwarded-proto");
    headers.delete("x-real-ip");
    // 关键保险：Worker fetch 默认无 User-Agent，部分 API 对此直接 403，伪装成浏览器 UA
    headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
    headers.set("Accept", "application/json");

    const resp = await fetch(upstreamURL, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      // @ts-ignore - 流式转发所需
      duplex: "half",
    });

    // 响应头：透传 + CORS；body 已被 Workers 解码，需去掉压缩相关的头
    const outHeaders = new Headers(resp.headers);
    Object.entries(CORS).forEach(([k, v]) => outHeaders.set(k, v));
    outHeaders.delete("content-encoding");
    outHeaders.delete("content-length");
    outHeaders.delete("transfer-encoding");

    return new Response(resp.body, { status: resp.status, headers: outHeaders });
  },
};
