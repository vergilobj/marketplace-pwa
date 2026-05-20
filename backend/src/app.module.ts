import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { InvitesModule } from './invites/invites.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { PaymentsModule } from './payments/payments.module';
import { PostsModule } from './posts/posts.module';
import { ChatModule } from './chat/chat.module';
import { CometChatModule } from './cometchat/cometchat.module';
import { SocialModule } from './social/social.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SettingsModule } from './settings/settings.module';
import { UploadModule } from './upload/upload.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    InvitesModule,
    MarketplaceModule,
    PaymentsModule,
    PostsModule,
    ChatModule,
    CometChatModule,
    SocialModule,
    NotificationsModule,
    SettingsModule,
    UploadModule,
    AdminModule,
  ],
})
export class AppModule {}