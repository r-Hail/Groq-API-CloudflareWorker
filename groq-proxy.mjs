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

    const upstreamURL = "https://groq.com";
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("Authorization", request.headers.get("Authorization") || "");
    headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

    let body = "{}";
    if (request.method === "POST") {
      const data = await request.json();
      delete data.repetition_penalty;
      delete data.top_k;
      delete data.min_p;
      delete data.top_a;
      delete data.logit_bias;
      delete data.presence_penalty;
      delete data.frequency_penalty;
      body = JSON.stringify(data);
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

    return new Response(resp.body, { status: resp.status, headers: outHeaders });
  },
};
