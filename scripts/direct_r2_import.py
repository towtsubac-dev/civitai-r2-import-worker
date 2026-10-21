#!/usr/bin/env python3
"""Transfer a Civitai safetensors model to test R2 using GitHub-hosted runner."""
import hashlib
import json
import os
import re
import sys
import uuid
from urllib.parse import urlparse

import boto3
import requests

MAX_BYTES = 512 * 1024 * 1024
PART_BYTES = 8 * 1024 * 1024
BUCKET = "civitai-lora-test"


def main():
    version_id = os.environ["MODEL_VERSION_ID"]
    if not re.fullmatch(r"[1-9][0-9]{0,14}", version_id):
        raise ValueError("Invalid model version ID")
    token = os.environ["CIVITAI_API_TOKEN"]
    account_id = os.environ["R2_ACCOUNT_ID"]
    access_key = os.environ["R2_ACCESS_KEY_ID"]
    secret_key = os.environ["R2_SECRET_ACCESS_KEY"]
    session = requests.Session()
    session.headers.update({"Authorization": "Bearer " + token})
    metadata = session.get(
        "https://civitai.com/api/v1/model-versions/" + version_id, timeout=30
    )
    metadata.raise_for_status()
    version = metadata.json()
    candidates = [
        f for f in version.get("files", [])
        if f.get("type") == "Model"
        and str(f.get("name", "")).lower().endswith(".safetensors")
        and re.fullmatch(r"[a-fA-F0-9]{64}", str(f.get("hashes", {}).get("SHA256", "")))
    ]
    if not candidates:
        raise ValueError("No SHA256-verified safetensors model file")
    file = candidates[0]
    expected_hash = file["hashes"]["SHA256"].lower()
    size_kb = float(file.get("sizeKB", 0))
    if not 0 < size_kb * 1024 <= MAX_BYTES:
        raise ValueError("Model exceeds 512 MiB or has unknown size")

    url = file.get("downloadUrl") or "https://civitai.com/api/download/models/" + version_id
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "civitai.com":
        raise ValueError("Unexpected Civitai download host")
    # requests follows the Civitai redirect to the download CDN.
    response = session.get(url, stream=True, timeout=(30, 120))
    response.raise_for_status()
    response.raw.decode_content = True
    if response.headers.get("Content-Length"):
        if int(response.headers["Content-Length"]) > MAX_BYTES:
            raise ValueError("Content-Length exceeds 512 MiB")

    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )
    key = "imports/" + str(uuid.uuid4()) + ".safetensors"
    object_metadata = {"civitai-version-id": version_id, "civitai-model-id": str(version.get("modelId", "")), "civitai-base-model": str(version.get("baseModel", ""))[:150], "civitai-model-name": str(version.get("model", {}).get("name", ""))[:150], "civitai-version-name": str(version.get("name", ""))[:150], "civitai-filename": str(file.get("name", ""))[:150]}
    upload_id = None
    parts = []
    digest = hashlib.sha256()
    total = 0
    buffer = bytearray()
    header_prefix = bytearray()
    header_length = None
    header_checked = False
    try:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if not chunk:
                continue
            total += len(chunk)
            if total > MAX_BYTES:
                raise ValueError("Stream exceeds 512 MiB")
            digest.update(chunk)
            if not header_checked:
                header_prefix.extend(chunk)
                if header_length is None and len(header_prefix) >= 8:
                    header_length = int.from_bytes(header_prefix[:8], "little")
                    if not 2 <= header_length <= 16 * 1024 * 1024:
                        raise ValueError("Invalid safetensors header length")
                if header_length is not None and len(header_prefix) >= header_length + 8:
                    header = json.loads(header_prefix[8:header_length + 8].decode("utf-8"))
                    if not isinstance(header, dict) or not any(k != "__metadata__" for k in header):
                        raise ValueError("Invalid safetensors header")
                    header_checked = True
                    header_prefix.clear()
                elif len(header_prefix) > 16 * 1024 * 1024 + 8:
                    raise ValueError("Oversized safetensors header")
            buffer.extend(chunk)
            while len(buffer) >= PART_BYTES:
                if upload_id is None:
                    upload_id = s3.create_multipart_upload(
                        Bucket=BUCKET, Key=key, ContentType="application/octet-stream", Metadata=object_metadata
                    )["UploadId"]
                part = bytes(buffer[:PART_BYTES])
                del buffer[:PART_BYTES]
                number = len(parts) + 1
                result = s3.upload_part(
                    Bucket=BUCKET, Key=key, UploadId=upload_id,
                    PartNumber=number, Body=part
                )
                parts.append({"PartNumber": number, "ETag": result["ETag"]})
        if not header_checked or not total:
            raise ValueError("Incomplete safetensors")
        actual_hash = digest.hexdigest()
        if actual_hash != expected_hash:
            raise ValueError("SHA256 mismatch")
        if upload_id is None:
            # For files smaller than one multipart part, upload only after validation.
            s3.put_object(Bucket=BUCKET, Key=key, Body=bytes(buffer),
                          ContentType="application/octet-stream", Metadata=object_metadata)
        else:
            if buffer:
                number = len(parts) + 1
                result = s3.upload_part(
                    Bucket=BUCKET, Key=key, UploadId=upload_id,
                    PartNumber=number, Body=bytes(buffer)
                )
                parts.append({"PartNumber": number, "ETag": result["ETag"]})
            s3.complete_multipart_upload(
                Bucket=BUCKET, Key=key, UploadId=upload_id,
                MultipartUpload={"Parts": parts}
            )
            upload_id = None
        head = s3.head_object(Bucket=BUCKET, Key=key)
        if head["ContentLength"] != total:
            raise ValueError("R2 object length mismatch")
        print(json.dumps({
            "status": "uploaded_to_test_bucket", "bucket": BUCKET, "key": key,
            "bytes": total, "sha256": actual_hash, "model_version_id": int(version_id)
        }))
    finally:
        response.close()
        if upload_id is not None:
            s3.abort_multipart_upload(Bucket=BUCKET, Key=key, UploadId=upload_id)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("Transfer failed:", type(exc).__name__, str(exc)[:400], file=sys.stderr)
        sys.exit(1)
