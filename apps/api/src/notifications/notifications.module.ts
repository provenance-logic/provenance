import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailModule } from '../email/email.module.js';
import { NotificationEntity } from './entities/notification.entity.js';
import { NotificationDeliveryOutboxEntity } from './entities/notification-delivery-outbox.entity.js';
import { PrincipalEntity } from '../organizations/entities/principal.entity.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationDeliveryWorker } from './notification-delivery.worker.js';

// Domain 11 — Notifications (ADR-009).
//
// PR #2 covered the in-platform tier; PR #3 (this version) adds the email
// channel:
//   - NotificationsService.enqueue now writes outbox rows for any category
//     whose default channels include 'email' (CATEGORY_DEFAULT_CHANNELS).
//   - NotificationDeliveryWorker drains pending rows on a 30-second cron via
//     the existing platform-wide EmailService (nodemailer, noop in tests).
//
// Webhook channel (PR #4), per-principal preferences (PR #5), notification
// center frontend (PR #6), and trigger-bundle wiring (PRs #7–12) remain.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      NotificationEntity,
      NotificationDeliveryOutboxEntity,
      PrincipalEntity,
    ]),
    EmailModule,
  ],
  providers: [NotificationsService, NotificationDeliveryWorker],
  controllers: [NotificationsController],
  exports: [NotificationsService, TypeOrmModule],
})
export class NotificationsModule {}
