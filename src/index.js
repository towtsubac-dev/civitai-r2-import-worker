import { sha256 } from "@noble/hashes/sha256";

const MAX_BYTES = 512 * 1024 * 1024;
const PART_BYTES = 8 * 1024 * 1024;
const MAX_AGE_MS = 5 * 60 * 1000;
const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const hex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, "0")).join("");
const error = (message, status = 400) => Object.assign(new Error(message), { status });

async function authorized(request, secret, body) {
  if (!secret) throw error("Signing secret not configured", 503);
  const timestamp = request.headers.get("x-import-timestamp");
  const signature = request.headers.get("x-import-signature");
  if (!timestamp || !/^\d{13}$/.test(timestamp) || !signature || !/^[a-f0-9]{64}$/i.test(signature)) {
    throw error("Missing or invalid signature", 401);
  }
  if (Math.abs(Date.now() - Number(timestamp)) > MAX_AGE_MS) throw error("Expired signature", 401);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + "." + body)));
  const received = Uint8Array.from(signature.match(/.{2}/g), x => parseInt(x, 16));
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected[i] ^ received[i];
  if (mismatch !== 0) throw error("Invalid signature", 401);
}

function validateHeader(bytes) {
  if (bytes.length < 9) throw error("Invalid safetensors header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lo = view.getUint32(0, true), hi = view.getUint32(4, true);
  if (hi !== 0 || lo < 2 || lo > 16 * 1024 * 1024) throw error("Invalid safetensors header length");
  return lo;
}

async function getVersion(versionId, token) {
  const headers = token ? { Authorization: "Bearer " + token } : {};
  const response = await fetch("https://civitai.com/api/v1/model-versions/" + versionId, { headers, redirect: "follow" });
  if (!response.ok) throw error("Civitai metadata request failed (" + response.status + ")", 502);
  const version = await response.json();
  const file = (version.files || []).find(f => f.type === "Model" && /\.safetensors$/i.test(f.name || "") && /^[a-f0-9]{64}$/i.test(f.hashes?.SHA256 || ""));
  if (!file) throw error("No SHA-256 verified safetensors file found");
  if (!Number.isSafeInteger(file.sizeKB) && !Number.isFinite(file.sizeKB)) throw error("File size missing");
  const approximateBytes = Math.ceil(file.sizeKB * 1024);
  if (approximateBytes <= 0 || approximateBytes > MAX_BYTES) throw error("File exceeds 512 MiB");
  return { file, version };
}

async function importVersion(env, payload) {
  if (!env.LORA_BUCKET) throw error("R2 binding not configured", 503);
  const versionId = payload.modelVersionId;
  if (!Number.isSafeInteger(versionId) || versionId < 1) throw error("Invalid modelVersionId");
  const { file, version } = await getVersion(versionId, env.CIVITAI_API_TOKEN);
  const url = new URL("https://civitai.com/api/download/models/" + versionId);
  if (env.CIVITAI_API_TOKEN) url.searchParams.set("token", env.CIVITAI_API_TOKEN);
  const download = await fetch(url.toString(), { redirect: "follow" });
  if (!download.ok || !download.body) throw error("Civitai download failed (" + download.status + ")", 502);
  const length = Number(download.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BYTES) { await download.body.cancel(); throw error("File exceeds 512 MiB"); }
  const id = crypto.randomUUID();
  const key = "imports/" + id + ".safetensors";
  const multipart = await env.LORA_BUCKET.createMultipartUpload(key, { httpMetadata: { contentType: "application/octet-stream" } });
  const parts = [], hasher = sha256.create(), reader = download.body.getReader();
  let bytesRead = 0, partNumber = 1, chunks = [], chunkLength = 0, firstBytes = new Uint8Array(0), headerLength = null, headerChecked = false;
  async function flush() {
    if (!chunkLength) return;
    const buffer = new Uint8Array(chunkLength);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
    parts.push(await multipart.uploadPart(partNumber++, buffer));
    chunks = []; chunkLength = 0;
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytesRead += value.length;
      if (bytesRead > MAX_BYTES) throw error("File exceeds 512 MiB");
      hasher.update(value);
      if (!headerChecked) {
        const merged = new Uint8Array(firstBytes.length + value.length);
        merged.set(firstBytes); merged.set(value, firstBytes.length);
        firstBytes = merged;
        if (headerLength === null && firstBytes.length >= 8) headerLength = validateHeader(firstBytes);
        if (headerLength !== null && firstBytes.length >= 8 + headerLength) {
          let header;
          try { header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(firstBytes.subarray(8, 8 + headerLength))); }
          catch { throw error("Invalid safetensors JSON header"); }
          if (!header || typeof header !== "object" || !Object.keys(header).some(k => k !== "__metadata__")) throw error("Invalid safetensors tensors");
          headerChecked = true;
          firstBytes = new Uint8Array(0);
        }
        if (firstBytes.length > 16 * 1024 * 1024 + 8) throw error("Oversized safetensors header");
      }
      let offset = 0;
      while (offset < value.length) {
        const take = Math.min(PART_BYTES - chunkLength, value.length - offset);
        chunks.push(value.subarray(offset, offset + take));
        chunkLength += take; offset += take;
        if (chunkLength === PART_BYTES) await flush();
      }
    }
    if (!headerChecked || bytesRead < 9) throw error("Incomplete safetensors file");
    const digest = hex(hasher.digest());
    if (digest.toLowerCase() !== file.hashes.SHA256.toLowerCase()) throw error("SHA-256 mismatch", 422);
    await flush();
    if (!parts.length) throw error("Empty upload");
    await multipart.complete(parts);
    return { id, key, bytes: bytesRead, sha256: digest, civitai_model_version_id: versionId, civitai_model_id: version.modelId, filename: file.name, status: "uploaded_to_test_bucket" };
  } catch (e) {
    try { await reader.cancel(); } catch {}
    try { await multipart.abort(); } catch {}
    throw e;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok", service: "civitai-r2-import", import_enabled: true,
        r2_binding: Boolean(env.LORA_BUCKET), signing_secret_configured: Boolean(env.LORA_IMPORT_SIGNING_SECRET) });
    }
    if (request.method !== "POST" || url.pathname !== "/import") return json({ error: "Not found" }, 404);
    try {
      if (Number(request.headers.get("content-length") || 0) > 4096) throw error("Request too large", 413);
      const body = await request.text();
      if (body.length > 4096) throw error("Request too large", 413);
      await authorized(request, env.LORA_IMPORT_SIGNING_SECRET, body);
      const payload = JSON.parse(body);
      if (!payload || typeof payload !== "object") throw error("Invalid request");
      const result = await importVersion(env, payload);
      return json(result, 201);
    } catch (e) {
      return json({ error: e instanceof SyntaxError ? "Invalid JSON" : (e.message || "Import failed") }, (e instanceof SyntaxError ? 400 : (e.status || 500)));
    }
  }
};
