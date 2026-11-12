const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "") {
      return new Response("Groq proxy OK", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS },
      });
    }

    const upstreamURL = "https://groq.com";

    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ipcountry");
    headers.delete("cf-ray");
    headers.delete("x-forwarded-for");
    headers.delete("x-forwarded-proto");
    headers.delete("x-real-ip");
    headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
    headers.set("Accept", "application/json");

    let body = undefined;
    try {
      const data = await request.json();
      delete data.repetition_penalty;
      delete data.top_k;
      delete data.min_p;
      delete data.top_a;
      data.stream = false;
      body = JSON.stringify(data);
      headers.delete("content-length");
    } catch (e) {
      return new Response(JSON.stringify({ error: { message: "Empty or non-POST request" } }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    const resp = await fetch(upstreamURL, {
      method: "POST",
      headers,
      body,
    });

    const outHeaders = new Headers(resp.headers);
    Object.entries(CORS).forEach(([k, v]) => outHeaders.set(k, v));
    outHeaders.delete("content-encoding");
    outHeaders.delete("content-length");
    outHeaders.delete("transfer-encoding");

    return new Response(resp.body, { status: resp.status, headers: outHeaders });
  },
};
