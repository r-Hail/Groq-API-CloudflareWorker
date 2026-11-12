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

    let isStream = false;
    let body = undefined;
    try {
      const data = await request.json();
      isStream = Boolean(data.stream);
      delete data.repetition_penalty;
      delete data.top_k;
      delete data.min_p;
      delete data.top_a;
      data.stream = false;
      body = JSON.stringify(data);
      headers.delete("content-length");
    } catch (e) {
      return new Response(JSON.stringify({ error: { message: "Invalid JSON" } }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    const resp = await fetch(upstreamURL, {
      method: "POST",
      headers,
      body,
    });

    const respText = await resp.text();

    if (!resp.ok) {
      return new Response(respText, {
        status: resp.status,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }

    if (isStream) {
      try {
        const json = JSON.parse(respText);
        const content = json.choices?.[0]?.message?.content || "";
        const chunk = {
          id: json.id || "chatcmpl-groq",
          object: "chat.completion.chunk",
          created: json.created || Math.floor(Date.now() / 1000),
          model: json.model || "llama-3.3-70b-versatile",
          choices: [{ index: 0, delta: { content }, finish_reason: "stop" }],
        };
        const sse = `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`;
        return new Response(sse, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            ...CORS,
          },
        });
      } catch (e) {}
    }

    return new Response(respText, {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  },
};
