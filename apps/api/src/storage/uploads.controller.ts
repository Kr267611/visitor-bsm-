import { randomUUID } from 'node:crypto';
import { Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthUser, CurrentUser, Public } from '../auth/roles.decorator';
import { ApiException } from '../common/api-exception';
import { StorageService } from './storage.service';

export const PHOTO_MAX_BYTES = 1024 * 1024;
export const photoInterceptor = () => FileInterceptor('photo', { limits: { fileSize: PHOTO_MAX_BYTES } });

/** File sach mein JPEG hai ya nahi, content type par bharosa nahi. */
export function requireJpeg(file: Express.Multer.File | undefined): Buffer {
  if (!file) throw new ApiException(422, 'VALIDATION_FAILED', 'Photo bhejein.');
  const b = file.buffer;
  if (!(b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) {
    throw new ApiException(422, 'VALIDATION_FAILED', 'Photo JPEG format mein honi chahiye.');
  }
  return b;
}

@Controller()
export class UploadsController {
  constructor(private readonly storage: StorageService) {}

  @Post('uploads/photo')
  @UseInterceptors(photoInterceptor())
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File | undefined) {
    const body = requireJpeg(file);
    const key = `uploads/${user.id}/${randomUUID()}.jpg`;
    await this.storage.put(key, body, 'image/jpeg');
    return { key };
  }

  @Public()
  @Get('photos/:token')
  async photo(@Param('token') token: string, @Res() res: Response) {
    let photo: Buffer | null;
    try {
      photo = await this.storage.readPhoto(token);
    } catch {
      throw new ApiException(401, 'UNAUTHORIZED', 'Photo ka link expire ho gaya hai.');
    }
    if (!photo) throw new ApiException(404, 'NOT_FOUND', 'Photo nahi mili.');
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=300' }).send(photo);
  }
}
