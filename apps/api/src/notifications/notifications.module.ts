import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailModule } from '../email/email.module.js';
import { NotificationEntity } from './entities/notification.entity.js';
import { NotificationDeliveryOutboxEntity } from './entities/notification-delivery-outbox.entity.js';
import { NotificationPreferenceEntity } from './entities/notification-preference.entity.js';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationDeliveryWorker } from './notification-delivery.worker.js';

// Domain 11 — Notifications (ADR-009).
//
// PR #2: in-platform tier (NotificationsService.enqueue + REST inbox).
// PR #3: email channel (delivery outbox + cron worker reusing EmailService).
// PR #5: per-principal preferences (this PR) — channel resolver consults
//        per-(principal, category) preferences when deciding which outbox
//        rows to write.
//
// Webhook channel (PR #4), notification center frontend (PR #6), and
// trigger-bundle wiring (PRs #7–12) remain.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      NotificationEntity,
      NotificationDeliveryOutboxEntity,
      NotificationPreferenceEntity,
      PrincipalEntity,
    ]),
    EmailModule,
  ],
  providers: [
    NotificationsService,
    NotificationPreferencesService,
    NotificationDeliveryWorker,
  ],
  controllers: [NotificationsController],
  exports: [NotificationsService, NotificationPreferencesService, TypeOrmModule],
})
export class NotificationsModule {}
