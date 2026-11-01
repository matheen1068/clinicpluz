import { createHash, randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import type { LogoContentType, LogoUpload } from './profile.js';

export interface StoredLogo { bytes: Uint8Array; contentType: LogoContentType }

export class S3ClinicLogoStore {
  constructor(private readonly client: S3Client, private readonly bucket: string,
    private readonly pendingBucket: string = bucket) {}

  private pendingKey(slug: string, uploadId: string, contentType: LogoContentType): string {
    if (!/^[a-z0-9-]{2,48}$/.test(slug) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uploadId)) {
      throw new Error('Invalid pending clinic logo');
    }
    return `staged/${slug}/${uploadId}.${contentType === 'image/png' ? 'png' : 'jpg'}`;
  }

  async preparePending(slug: string, contentType: LogoContentType): Promise<{
    uploadId: string; url: string; fields: Record<string, string> }> {
    const uploadId = randomUUID();
    const key = this.pendingKey(slug, uploadId, contentType);
    const signed = await createPresignedPost(this.client, {
      Bucket: this.pendingBucket, Key: key, Expires: 300,
      Fields: { 'Content-Type': contentType, 'x-amz-server-side-encryption': 'AES256' },
      // POST includes signed form fields as well as the file. Finalization enforces 3,000,000 file bytes.
      Conditions: [['content-length-range', 1, 3_020_000],
        ['eq', '$key', key], ['eq', '$Content-Type', contentType],
        ['eq', '$x-amz-server-side-encryption', 'AES256']],
    });
    return { uploadId, url: signed.url, fields: signed.fields };
  }

  async readPending(slug: string, uploadId: string, contentType: LogoContentType): Promise<Uint8Array | null> {
    const key = this.pendingKey(slug, uploadId, contentType);
    let object;
    try { object = await this.client.send(new GetObjectCommand({ Bucket: this.pendingBucket, Key: key })); }
    catch (error) {
      if (error && typeof error === 'object' && 'name' in error &&
          (error.name === 'NoSuchKey' || error.name === 'NotFound')) return null;
      throw error;
    }
    if (object.ContentType !== contentType || !object.ContentLength || object.ContentLength > 3_000_000 ||
        !object.LastModified || Date.now() - object.LastModified.getTime() > 10 * 60_000 ||
        object.LastModified.getTime() > Date.now() + 60_000 || !object.Body) return null;
    const bytes = await object.Body.transformToByteArray();
    return bytes.length === object.ContentLength ? bytes : null;
  }

  async removePending(slug: string, uploadId: string, contentType: LogoContentType): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.pendingBucket,
      Key: this.pendingKey(slug, uploadId, contentType) }));
  }

  async put(slug: string, upload: LogoUpload): Promise<string> {
    const extension = upload.contentType === 'image/png' ? 'png' : 'jpg';
    const key = `clinics/${slug}/${randomUUID()}.${extension}`;
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key,
      Body: upload.bytes, ContentType: upload.contentType, ContentLength: upload.bytes.length,
      CacheControl: 'no-store', ServerSideEncryption: 'AES256', Metadata: { sha256: upload.sha256 } }));
    return key;
  }

  async get(slug: string, logo: { key: string; contentType: LogoContentType; sha256: string }): Promise<StoredLogo> {
    if (!new RegExp(`^clinics/${slug}/[0-9a-f-]{36}\\.(?:png|jpg)$`).test(logo.key)) {
      throw new Error('Invalid clinic logo key');
    }
    const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: logo.key }));
    if (!object.Body || object.ContentType !== logo.contentType ||
        !object.ContentLength || object.ContentLength > 3_000_000 ||
        object.Metadata?.sha256 !== logo.sha256) throw new Error('Invalid clinic logo object');
    const bytes = await object.Body.transformToByteArray();
    if (bytes.length !== object.ContentLength ||
        createHash('sha256').update(bytes).digest('hex') !== logo.sha256) {
      throw new Error('Clinic logo checksum mismatch');
    }
    return { bytes, contentType: logo.contentType };
  }

  async removeStaged(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
