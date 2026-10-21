# Civitai streaming import (test only)

This implementation is in a **draft branch**. Do not merge or enable production until tested.

## Endpoint

`POST /import` accepts JSON `{"modelVersionId":123456}`. It looks up the model version through the Civitai API, requires a SHA-256 hash and a safetensors model file, downloads it from Civitai, and uploads to the **test** R2 bucket at `imports/{uuid}.safetensors`. Limit: 512 MiB. It checks the safetensors JSON header and verifies SHA-256 before completing the multipart upload.

## Authentication

Headers:
- `x-import-timestamp`: current Unix milliseconds (13 digits)
- `x-import-signature`: lowercase hex HMAC-SHA256 of UTF-8 `timestamp + "." + raw_request_body`, using `LORA_IMPORT_SIGNING_SECRET` as UTF-8 key.

The signed timestamp is valid for 5 minutes. This is **not replay-proof**: do not expose signing secrets or signing functionality to browsers. Generate signatures on a trusted server only. Before production, implement nonce replay prevention, request quotas, and concurrency limits.

If Civitai requires an access token, configure `CIVITAI_API_TOKEN` as a Cloudflare Secret. Do not commit secrets.

## Important limitations

- This is a **test-bucket importer**, not an integration with the existing LoRA library UI or its metadata format.
- Multipart upload aborts on validation or transfer errors, but network failures should still be monitored for orphaned uploads.
- A Cloudflare Worker may be subject to runtime, request-duration, subrequest and CPU limits. A 300–512 MiB transfer is **not yet verified**.
- Do not merge the draft PR before reviewing and testing authentication, metadata parsing, download redirects, and multipart completion.
