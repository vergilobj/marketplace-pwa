import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UploadService {
  constructor(private config: ConfigService) {}

  getFileUrl(filename: string): string {
    const base = this.config.get('UPLOAD_BASE_URL') || 'http://localhost:3000';
    return `${base}/uploads/${filename}`;
  }
}