import {
  ConflictException,
  HttpException,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import sharp from 'sharp';
import type { Prisma } from '@restaurant/database';
import type { MenuMediaUpload } from '@restaurant/shared-types';
import { isMenuMediaPath } from '@restaurant/validation';
import { DatabaseService } from '../database.service';

/**
 * Menu images: validation, the POS rendition, persistent storage and safe cleanup.
 *
 * FastFood Riza is local-first, so images live on this machine rather than a CDN, in a
 * directory that production mounts as a persistent volume. Only a stable relative path is
 * stored on a product or offer, so moving between localhost, a LAN address and a new
 * server needs no data rewrite.
 */
export const MEDIA_LIMIT_BYTES = 5 * 1024 * 1024;
export const MENU_IMAGE_SIZE = 1024;
const MIN_SIDE = 200;
const MAX_SIDE = 8000;
const FILE_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/;
// Uploads left unreferenced (a cancelled edit, a replaced image that a concurrent save
// still held) are removed after this grace period, and never while referenced.
const SWEEP_AFTER_MS = 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;

export type ImageFormat = 'png' | 'jpeg' | 'webp';

/** An upload refused for a reason the operator can act on. */
export class MediaError extends HttpException {}

/**
 * Identify an image from its leading bytes. The declared content type and any original
 * filename are ignored: they are client-controlled and prove nothing about the content.
 */
export function sniffImage(buffer: Buffer): ImageFormat | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length >= 8 && png.every((byte, i) => buffer[i] === byte)) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return 'jpeg';
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'webp';
  return null;
}

/**
 * Validate an upload and render the POS square: 1024 × 1024, cropped to cover, WebP.
 * Re-encoding also drops embedded metadata such as camera location.
 */
export async function renderMenuImage(buffer: Buffer): Promise<Buffer> {
  if (!buffer.length) throw new MediaError('Choose a PNG, JPEG or WebP image', 415);
  if (buffer.length > MEDIA_LIMIT_BYTES)
    throw new MediaError('Images must be 5 MB or smaller', 413);
  const format = sniffImage(buffer);
  if (!format) throw new MediaError('Choose a PNG, JPEG or WebP image', 415);
  // Decoding is bounded, so a small file claiming enormous dimensions cannot exhaust
  // memory, and invalid pixel data aborts instead of producing a half-grey picture.
  const open = () => sharp(buffer, { limitInputPixels: MAX_SIDE * MAX_SIDE, failOn: 'error' });
  let metadata: sharp.Metadata;
  try {
    metadata = await open().metadata();
  } catch {
    throw new MediaError('This image is damaged or incomplete', 422);
  }
  if (metadata.format !== format) throw new MediaError('This image is damaged or incomplete', 422);
  const { width = 0, height = 0 } = metadata;
  if (width < MIN_SIDE || height < MIN_SIDE)
    throw new MediaError('Images must be at least 200 × 200 pixels', 422);
  if (width > MAX_SIDE || height > MAX_SIDE)
    throw new MediaError('Images must be at most 8000 pixels on each side', 422);
  try {
    return await open()
      .rotate()
      .resize(MENU_IMAGE_SIZE, MENU_IMAGE_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new MediaError('This image is damaged or incomplete', 422);
  }
}

// One lock orders every change to which images are referenced against their deletion, so
// a file is never removed between a save checking that it exists and that save committing.
const lockReferences = (tx: Prisma.TransactionClient) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('restaurant.menu-media'))`;

@Injectable()
export class MediaService implements OnModuleInit {
  private readonly root: string;
  private readonly directory: string;
  private lastSweep = 0;
  constructor(private readonly db: DatabaseService) {
    this.root = resolve(process.env.MEDIA_ROOT ?? join('.local', 'media'));
    this.directory = join(this.root, 'menu');
  }
  async onModuleInit() {
    await mkdir(this.directory, { recursive: true });
  }
  /** Where a managed path lives on disk, or null for anything that is not one. */
  location(path: string | null | undefined): string | null {
    if (!isMenuMediaPath(path)) return null;
    return this.fileLocation(path.slice(path.lastIndexOf('/') + 1));
  }
  fileLocation(name: string): string | null {
    if (!FILE_NAME.test(name)) return null;
    const location = join(this.directory, name);
    return isAbsolute(location) && location.startsWith(this.directory) ? location : null;
  }
  async store(buffer: Buffer): Promise<MenuMediaUpload> {
    const data = await renderMenuImage(buffer);
    const name = `${randomUUID()}.webp`;
    const final = join(this.directory, name);
    // Written beside its final name and then renamed, so a reader never sees half a file.
    const partial = `${final}.partial`;
    await mkdir(this.directory, { recursive: true });
    await writeFile(partial, data, { flag: 'wx' });
    await rename(partial, final);
    void this.sweepIfDue();
    return { path: `/api/media/menu/${name}`, width: MENU_IMAGE_SIZE, height: MENU_IMAGE_SIZE, bytes: data.length };
  }
  /**
   * Called inside the transaction that is about to reference a newly chosen image. It
   * holds the reference lock until that transaction ends, so cleanup cannot remove the
   * file in between, and refuses a managed path whose file is gone.
   */
  async assertAvailable(tx: Prisma.TransactionClient, path: string | null) {
    const location = this.location(path);
    if (!location) return;
    await lockReferences(tx);
    if (!(await exists(location)))
      throw new ConflictException('This image is no longer available. Upload it again.');
  }
  /**
   * After a save has committed and stopped referencing an image, delete the file unless
   * another product or offer still uses it. Failure never undoes the committed save: a
   * leftover file is harmless and the periodic sweep removes it.
   */
  async release(path: string | null | undefined) {
    const location = this.location(path);
    if (!location) return;
    try {
      await this.db.client.$transaction(async (tx) => {
        await lockReferences(tx);
        if (await this.referenced(tx, path!)) return;
        await rm(location, { force: true });
      });
    } catch {
      // Left for the sweep.
    }
  }
  /** Remove managed files that nothing references and that are past the grace period. */
  async sweep(now = Date.now()) {
    let removed = 0;
    for (const name of await readdir(this.directory).catch(() => [] as string[])) {
      const location = this.fileLocation(name);
      const stale = location && now - (await stat(location)).mtimeMs > SWEEP_AFTER_MS;
      if (!stale) continue;
      await this.db.client.$transaction(async (tx) => {
        await lockReferences(tx);
        if (await this.referenced(tx, `/api/media/menu/${name}`)) return;
        await rm(location, { force: true });
        removed++;
      });
    }
    return removed;
  }
  private async sweepIfDue() {
    if (Date.now() - this.lastSweep < SWEEP_EVERY_MS) return;
    this.lastSweep = Date.now();
    await this.sweep().catch(() => undefined);
  }
  // Media is shared across branches on this machine, so references are checked
  // everywhere: a file is kept while any product or offer in any branch points at it.
  private async referenced(tx: Prisma.TransactionClient, path: string) {
    const [products, offers] = await Promise.all([
      tx.product.count({ where: { imageUrl: path } }),
      tx.offer.count({ where: { imageUrl: path } }),
    ]);
    return products + offers > 0;
  }
}

async function exists(location: string) {
  try {
    return (await stat(location)).isFile();
  } catch {
    return false;
  }
}
