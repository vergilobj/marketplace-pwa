import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UploadService } from './upload.service';
import { UploadsReplicationService } from './uploads-replication.service';
import { ImageOptimizerService } from './image-optimizer.service';
import { join } from 'path';

const VIDEO_MIMES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
]);

const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.mkv']);

// Изображения: whitelist MIME + расширений.
// ⚠️ Проверяем ОБА признака — mimetype подделывается клиентом,
// а имя файла задаёт расширение, по которому статика отдаёт Content-Type.
const IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const IMAGE_ERROR =
  'Поддерживаются только изображения jpg, jpeg, png, webp или gif';

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

const imageStorage = diskStorage({
  destination: (req, file, cb) => {
    ensureDir('./uploads');
    cb(null, './uploads');
  },
  filename: (req, file, cb) => {
    const uniqueName = uuidv4() + extname(file.originalname).toLowerCase();
    cb(null, uniqueName);
  },
});

const videoStorage = diskStorage({
  destination: (req, file, cb) => {
    ensureDir('./uploads/videos');
    cb(null, './uploads/videos');
  },
  filename: (req, file, cb) => {
    const uniqueName = uuidv4() + extname(file.originalname).toLowerCase();
    cb(null, uniqueName);
  },
});

@Controller('upload')
export class UploadController {
  constructor(
    private uploadService: UploadService,
    private replication: UploadsReplicationService,
    private optimizer: ImageOptimizerService,
  ) {}

  // Картинки (оставляем существующий эндпоинт).
  @UseGuards(JwtAuthGuard)
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: imageStorage,
      limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
      fileFilter: (req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        const isImageMime = IMAGE_MIMES.has(file.mimetype);
        const isImageExt = IMAGE_EXTS.has(ext);
        if (isImageMime && isImageExt) {
          cb(null, true);
        } else {
          cb(new BadRequestException(IMAGE_ERROR), false);
        }
      },
    }),
  )
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    // FIX-REST фикс 3: файл сжимается ДО репликации — иначе на вторую ноду
    // уедет тяжёлый оригинал, а оптимизируется только локальная копия.
    // Best-effort: сбой сжатия не должен ломать загрузку (см. сервис).
    await this.optimizer.optimize(join('./uploads', file.filename));

    // PD-FIX-1: файл лёг только на ЭТУ ноду — копируем на вторую (best-effort),
    // иначе у половины пользователей картинка будет 404 (nginx гео-роутит).
    this.replication.replicate(file.filename);
    return { url: this.uploadService.getFileUrl(file.filename) };
  }

  // Видео: свой эндпоинт, свой лимит и фильтр по MIME/расширению.
  @UseGuards(JwtAuthGuard)
  @Post('video')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: videoStorage,
      limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
      fileFilter: (req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        const isVideoMime = VIDEO_MIMES.has(file.mimetype);
        const isVideoExt = VIDEO_EXTS.has(ext);
        if (isVideoMime && isVideoExt) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              'Поддерживаются только видео mp4, webm, mov или mkv',
            ),
            false,
          );
        }
      },
    }),
  )
  uploadVideo(@UploadedFile() file: Express.Multer.File) {
    // PD-FIX-1: видео реплицируем в подпапку videos/ (тот же механизм).
    this.replication.replicate(`videos/${file.filename}`);
    return { url: this.uploadService.getVideoUrl(file.filename) };
  }
}
