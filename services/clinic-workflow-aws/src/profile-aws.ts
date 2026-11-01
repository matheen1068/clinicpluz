import { createHash, randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { LogoContentType, LogoUpload } from './profile.js';

export interface StoredLogo { bytes: Uint8Array; contentType: LogoContentType }

export class S3ClinicLogoStore {
  constructor(private readonly client: S3Client, private readonly bucket: string) {}

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
