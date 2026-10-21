# Civitai R2 Import Worker (Preview)

This repository deploys the isolated `civitai-r2-import-preview` Worker.

**Status: scaffold only.** The Worker responds to GET /health and rejects all other requests with HTTP 503. It does not download, upload, overwrite, or delete any R2 objects.

Cloudflare Workers Builds: connect this repository, select main, leave build command blank, set deploy command to `npx wrangler deploy`.

Later, configure an R2 binding named `LORA_BUCKET` pointing to a separate test bucket and a secret `LORA_IMPORT_SIGNING_SECRET`. Never paste secret values into GitHub.

Large-file importer (HMAC validation, Civitai metadata lookup, streaming R2 multipart transfer, SHA-256 and safetensors validation, cleanup, and UI integration) is **not implemented** yet. Do not enable production use until end-to-end tests pass.
