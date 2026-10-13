import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { NotificationPreference } from './entities/notification-preference.entity.js';
import { NotificationToken } from './entities/notification-token.entity.js';
import { NotificationDelivery } from './entities/notification-delivery.entity.js';
import { Pond } from '../ponds/entities/pond.entity.js';
import { User } from '../users/entities/user.entity.js';
import { Alert } from '../alerts/entities/alert.entity.js';
import { EmailModule } from '../email/email.module.js';
import { FcmService } from './fcm.service.js';
import { NotificationTokensService } from './notification-tokens.service.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { NotificationDispatcherService } from './notification-dispatcher.service.js';
import { NotificationsController } from './notifications.controller.js';

@Module({
  imports: [
    ConfigModule,
    EmailModule,
    TypeOrmModule.forFeature([
      NotificationPreference,
      NotificationToken,
      NotificationDelivery,
      Pond,
      User,
      Alert,
    ]),
  ],
  controllers: [NotificationsController],
  providers: [
    FcmService,
    NotificationTokensService,
    NotificationPreferencesService,
    NotificationDispatcherService,
  ],
  exports: [
    NotificationDispatcherService,
    NotificationPreferencesService,
    NotificationTokensService,
    FcmService,
  ],
})
export class NotificationsModule {}
