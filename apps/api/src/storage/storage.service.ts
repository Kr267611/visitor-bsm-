import { Global, Injectable, Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { AuthModule } from '../auth/auth.module';

export interface BlobStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

/** For tests and local development. */
export class MemoryBlobStore implements BlobStore {
  private readonly blobs = new Map<string, Buffer>();

  async put(key: string, body: Buffer) {
    this.blobs.set(key, body);
  }
  async get(key: string) {
    return this.blobs.get(key) ?? null;
  }
  async exists(key: string) {
    return this.blobs.has(key);
  }
  async delete(key: string) {
    this.blobs.delete(key);
  }
}

/** Any S3-compatible bucket: MinIO, Cloudflare R2, AWS S3. */
export class S3BlobStore implements BlobStore {
  private readonly client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'auto',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY as string,
      secretAccessKey: process.env.S3_SECRET_KEY as string,
    },
  });
  private readonly bucket = process.env.S3_BUCKET as string;

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async get(key: string) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return Buffer.from(await (res.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
    } catch (e) {
      if ((e as Error).name === 'NoSuchKey') return null;
      throw e;
    }
  }

  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (e) {
      if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
      throw e;
    }
  }
}

@Injectable()
export class StorageService {
  private readonly store: BlobStore =
    process.env.STORAGE_DRIVER === 'memory' ? new MemoryBlobStore() : new S3BlobStore();
  // A secret separate from access tokens, so a photo link can never be used to sign in.
  private readonly photoSecret = `${process.env.JWT_SECRET}:photo`;

  constructor(private readonly jwt: JwtService) {}

  put(key: string, body: Buffer, contentType: string) {
    return this.store.put(key, body, contentType);
  }

  exists(key: string) {
    return this.store.exists(key);
  }

  delete(key: string) {
    return this.store.delete(key);
  }

  /** Short-lived link on our API. Clients never see the storage host. */
  photoUrl(key: string, seconds = 300): string {
    const token = this.jwt.sign({ k: key }, { secret: this.photoSecret, expiresIn: seconds });
    return `${process.env.API_URL}/photos/${token}`;
  }

  /** Returns the photo for a valid token. Throws when it is invalid or expired. */
  async readPhoto(token: string): Promise<Buffer | null> {
    const { k } = await this.jwt.verifyAsync<{ k: string }>(token, { secret: this.photoSecret });
    return this.store.get(k);
  }
}

@Global()
@Module({
  imports: [AuthModule],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
