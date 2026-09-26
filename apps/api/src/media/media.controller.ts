import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Response } from 'express';
import { type ApiRequest, Public, RequirePermissions } from '../auth/authorization';
import { MediaError, MediaService } from './media.service';

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}
  /**
   * Store a menu image. The body is the raw file; nothing is written to the database, so
   * an operator can preview an upload and still cancel. A product or offer references the
   * returned path only when it is explicitly saved.
   */
  @Post('menu') @RequirePermissions('menu.read', 'menu.manage') upload(
    @Req() r: ApiRequest & { body?: unknown },
  ) {
    if (!Buffer.isBuffer(r.body)) throw new MediaError('Choose a PNG, JPEG or WebP image', 415);
    return this.media.store(r.body);
  }
  /**
   * Menu images are public within the restaurant: the POS renders them with plain <img>
   * elements, which cannot carry a bearer token. Names are random UUIDs and each file is
   * written once and never changed, so it can be cached indefinitely.
   */
  @Get('menu/:file') @Public() async serve(@Param('file') file: string, @Res() res: Response) {
    const location = this.media.fileLocation(file);
    const info = location ? await stat(location).catch(() => null) : null;
    if (!location || !info?.isFile()) throw new NotFoundException('Image not found');
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Content-Length', String(info.size));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    createReadStream(location).pipe(res);
  }
}
