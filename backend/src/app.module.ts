import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SettingsModule } from './settings/settings.module';
import { InvitesModule } from './invites/invites.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { PostsModule } from './posts/posts.module';
import { ChatModule } from './chat/chat.module';
import { NotificationsModule } from './notifications/notifications.module';
import { UploadModule } from './upload/upload.module';
import { SocialModule } from './social/social.module';
import { CometChatModule } from './cometchat/cometchat.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SettingsModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    InvitesModule,
    PostsModule,
    ChatModule,
    SocialModule,
    UploadModule,
    NotificationsModule,
    MarketplaceModule,
    CometChatModule,
  ],
})
export class AppModule {}