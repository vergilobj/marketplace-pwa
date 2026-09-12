import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { UploadsReplicationService } from './uploads-replication.service';
import { ImageOptimizerService } from './image-optimizer.service';

@Module({
  controllers: [UploadController],
  providers: [UploadService, UploadsReplicationService, ImageOptimizerService],
  exports: [UploadsReplicationService, ImageOptimizerService],
})
export class UploadModule {}