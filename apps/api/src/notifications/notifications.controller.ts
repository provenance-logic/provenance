import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { ReqContext } from '../auth/request-context.decorator.js';
import { NotificationsService } from './notifications.service.js';
import type {
  RequestContext,
  Notification,
  NotificationCategory,
  NotificationList,
} from '@provenance/types';

// Domain 11 in-platform notification surface (PR #2 of the Domain 11 phasing).
//
// Recipient is always the calling principal — read access to another
// principal's inbox is not exposed on this surface (and is not exposed
// elsewhere either; admin tooling is governed separately).
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations/:orgId/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(
    @ReqContext() ctx: RequestContext,
    @Query('category') category?: NotificationCategory,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('excludeDismissed') excludeDismissed?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<NotificationList> {
    return this.notificationsService.list(ctx.orgId, ctx.principalId, {
      ...(category !== undefined && { category }),
      ...(unreadOnly !== undefined && { unreadOnly: unreadOnly === 'true' }),
      ...(excludeDismissed !== undefined && {
        excludeDismissed: excludeDismissed !== 'false',
      }),
      limit: limit ? parseInt(limit, 10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }

  @Post(':notificationId/read')
  @HttpCode(HttpStatus.OK)
  markRead(
    @ReqContext() ctx: RequestContext,
    @Param('notificationId') notificationId: string,
  ): Promise<Notification> {
    return this.notificationsService.markRead(
      ctx.orgId,
      ctx.principalId,
      notificationId,
    );
  }

  @Post(':notificationId/dismiss')
  @HttpCode(HttpStatus.OK)
  dismiss(
    @ReqContext() ctx: RequestContext,
    @Param('notificationId') notificationId: string,
  ): Promise<Notification> {
    return this.notificationsService.dismiss(
      ctx.orgId,
      ctx.principalId,
      notificationId,
    );
  }
}
