// ===========================================
// Cloudflare R2 Client (S3-compatible)
// Used to store user-uploaded project ZIPs for review.
// ===========================================

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import logger from "../utils/logger.js";

const REQUIRED = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
];

let _client = null;

function getClient() {
  if (_client) return _client;
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `R2 client missing env vars: ${missing.join(", ")}. ` +
        `Set them in .env to enable ZIP uploads.`
    );
  }
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  logger.info("[R2] Client initialised");
  return _client;
}

export async function uploadBuffer(key, buffer, contentType = "application/zip") {
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );
  return { key, bucket: process.env.R2_BUCKET };
}

export async function getObjectBuffer(key) {
  const client = getClient();
  const out = await client.send(
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key })
  );
  // Body is a Readable stream
  const chunks = [];
  for await (const chunk of out.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function deleteObject(key) {
  const client = getClient();
  await client.send(
    new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key })
  );
}

export default { uploadBuffer, getObjectBuffer, deleteObject };
