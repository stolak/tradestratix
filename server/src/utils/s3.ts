import { PutObjectCommand, S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { httpError, shortId } from './helpers.js';

const region = process.env.AWS_REGION || 'af-south-1';
const bucket = process.env.AWS_S3_BUCKET_NAME || '';
const cdn = (process.env.AWS_CDN || '').replace(/\/$/, '');

let client: S3Client | null = null;

function getClient() {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw httpError(500, 'S3 is not configured (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)');
  }
  if (!bucket) throw httpError(500, 'S3 is not configured (AWS_S3_BUCKET_NAME)');
  if (!client) {
    client = new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });
  }
  return client;
}

export function s3Configured() {
  return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && bucket);
}

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf'
]);

export function assertAllowedProofFile(mime: string, size: number) {
  if (!ALLOWED_MIME.has(mime)) {
    throw httpError(400, 'Proof file must be a JPEG, PNG, WebP, GIF or PDF');
  }
  const max = 8 * 1024 * 1024;
  if (size > max) throw httpError(400, 'Proof file must be 8 MB or smaller');
}

function extFor(mime: string, originalName?: string) {
  const fromName = originalName?.includes('.') ? originalName.split('.').pop()?.toLowerCase() : null;
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'application/pdf') return 'pdf';
  return 'bin';
}

/**
 * Upload a proof-of-collection / delivery file to S3.
 * Returns the public CDN (or S3 object) URL and the object key.
 */
export async function uploadProofObject(input: {
  businessId: string;
  fulfilmentId: string;
  buffer: Buffer;
  mimeType: string;
  originalName?: string;
  kind?: string;
}) {
  assertAllowedProofFile(input.mimeType, input.buffer.length);
  const s3 = getClient();
  const ext = extFor(input.mimeType, input.originalName);
  const kind = (input.kind || 'proof').replace(/[^a-z0-9_-]/gi, '') || 'proof';
  const key = `tradestratix/${input.businessId}/fulfilment/${input.fulfilmentId}/${kind}-${shortId('pf')}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: input.buffer,
      ContentType: input.mimeType,
      // Bucket policy / ACL may already allow public read via CDN; omit ACL for restrictive buckets.
      Metadata: {
        businessId: input.businessId,
        fulfilmentId: input.fulfilmentId
      }
    })
  );

  const url = cdn ? `${cdn}/${key}` : `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  return { key, url, bucket, region };
}

export async function deleteProofObject(key: string) {
  if (!key || !s3Configured()) return;
  const s3 = getClient();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
