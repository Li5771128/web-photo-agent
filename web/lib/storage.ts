import { CopyObjectCommand, CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getConfig } from "./config";

let client: S3Client | undefined;
function getClient(): S3Client {
  const config = getConfig();
  client ??= new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
  });
  return client;
}

let bucketPromise: Promise<void> | undefined;
async function ensureBucket(): Promise<void> {
  const config = getConfig();
  try { await getClient().send(new HeadBucketCommand({ Bucket: config.S3_BUCKET })); }
  catch { await getClient().send(new CreateBucketCommand({ Bucket: config.S3_BUCKET })); }
}

export async function storeObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const config = getConfig();
  bucketPromise ??= ensureBucket();
  await bucketPromise;
  await getClient().send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
}

export async function deleteObject(key: string): Promise<void> {
  const config = getConfig();
  await getClient().send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
}

export async function copyObject(sourceKey: string, destinationKey: string): Promise<void> {
  const config = getConfig();
  await getClient().send(new CopyObjectCommand({
    Bucket: config.S3_BUCKET,
    CopySource: `${config.S3_BUCKET}/${sourceKey.split("/").map(encodeURIComponent).join("/")}`,
    Key: destinationKey,
  }));
}

export async function readObject(key: string): Promise<{ body: Uint8Array; contentType: string }> {
  const config = getConfig();
  const response = await getClient().send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
  if (!response.Body) throw new Error("object body unavailable");
  return {
    body: await response.Body.transformToByteArray(),
    contentType: response.ContentType ?? "application/octet-stream",
  };
}
