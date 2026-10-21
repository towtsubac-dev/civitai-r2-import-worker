// Import intentionally disabled until secure signed requests and R2 streaming are implemented.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        status: "ok",
        service: "civitai-r2-import",
        import_enabled: false,
        r2_binding: Boolean(env.LORA_BUCKET),
        signing_secret_configured: Boolean(env.LORA_IMPORT_SIGNING_SECRET)
      }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "Import not enabled" }, {
      status: 503, headers: { "Cache-Control": "no-store" }
    });
  }
};
