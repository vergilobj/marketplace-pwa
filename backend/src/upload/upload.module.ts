import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { UploadsReplicationService } from './uploads-replication.service';

@Module({
  controllers: [UploadController],
  providers: [UploadService, UploadsReplicationService],
  exports: [UploadsReplicationService],
})
export class UploadModule {}