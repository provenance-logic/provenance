import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationEntity } from './entities/notification.entity.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsController } from './notifications.controller.js';

// Domain 11 — Notifications (ADR-009).
//
// PR #2 covers the in-platform tier: NotificationsService.enqueue() writes
// rows directly to notifications.notifications, which is also the inbox the
// frontend reads from. Email channel, webhook channel, principal preferences,
// org-level channel defaults, and trigger-bundle wiring all land in
// subsequent PRs per the phasing in CLAUDE.md.
@Module({
  imports: [TypeOrmModule.forFeature([NotificationEntity])],
  providers: [NotificationsService],
  controllers: [NotificationsController],
  exports: [NotificationsService, TypeOrmModule],
})
export class NotificationsModule {}
