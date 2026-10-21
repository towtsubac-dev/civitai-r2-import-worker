import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker from "../src/index.js";

const secret = "unit-test-secret-not-for-deployment";
const env = { LORA_BUCKET: {}, LORA_IMPORT_SIGNING_SECRET: secret };
const endpoint = "https://example.workers.dev/import";

async function signed(body, timestamp = String(Date.now()), key = secret) {
  const signature = createHmac("sha256", key).update(timestamp + "." + body).digest("hex");
  return worker.fetch(new Request(endpoint, {
    method: "POST", body,
    headers: { "x-import-timestamp": timestamp, "x-import-signature": signature }
  }), env);
}

test("health reports bindings", async () => {
  const res = await worker.fetch(new Request("https://example.workers.dev/health"), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    status: "ok", service: "civitai-r2-import", import_enabled: true,
    r2_binding: true, signing_secret_configured: true
  });
});

test("rejects unauthenticated requests", async () => {
  const res = await worker.fetch(new Request(endpoint, { method: "POST", body: "{}" }), env);
  assert.equal(res.status, 401);
});

test("rejects wrong signature", async () => {
  const res = await signed('{"modelVersionId":1}', String(Date.now()), "wrong-key");
  assert.equal(res.status, 401);
});

test("rejects expired timestamp", async () => {
  const res = await signed('{"modelVersionId":1}', String(Date.now() - 600000));
  assert.equal(res.status, 401);
});

test("rejects malformed model version ID before network access", async () => {
  const res = await signed('{"modelVersionId":"not-a-number"}');
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /modelVersionId/);
});

test("rejects malformed JSON", async () => {
  const res = await signed('{');
  assert.equal(res.status, 400);
});

test("rejects non-import routes", async () => {
  const res = await worker.fetch(new Request("https://example.workers.dev/other"), env);
  assert.equal(res.status, 404);
});
