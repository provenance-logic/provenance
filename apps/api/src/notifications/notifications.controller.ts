import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
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
import { NotificationPreferencesService } from './notification-preferences.service.js';
import type {
  RequestContext,
  Notification,
  NotificationCategory,
  NotificationList,
  NotificationPreference,
  PrincipalNotificationSettings,
  UpdateNotificationPreferenceRequest,
  UpdatePrincipalNotificationSettingsRequest,
} from '@provenance/types';

// Domain 11 notification surface.
//
// Inbox endpoints (PR #2): GET /, POST /:id/read, POST /:id/dismiss.
// Preferences endpoints (PR #5): GET/PUT/DELETE /preferences/:category.
//
// All routes scope by the calling principal — read or write access to another
// principal's inbox or preferences is never exposed on this surface.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations/:orgId/notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly preferencesService: NotificationPreferencesService,
  ) {}

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

  @Get('preferences')
  listPreferences(
    @ReqContext() ctx: RequestContext,
  ): Promise<NotificationPreference[]> {
    return this.preferencesService.list(ctx.orgId, ctx.principalId);
  }

  @Put('preferences/:category')
  upsertPreference(
    @ReqContext() ctx: RequestContext,
    @Param('category') category: NotificationCategory,
    @Body() body: UpdateNotificationPreferenceRequest,
  ): Promise<NotificationPreference> {
    return this.preferencesService.upsert(
      ctx.orgId,
      ctx.principalId,
      category,
      body,
    );
  }

  @Delete('preferences/:category')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPreference(
    @ReqContext() ctx: RequestContext,
    @Param('category') category: NotificationCategory,
  ): Promise<void> {
    return this.preferencesService.reset(ctx.principalId, category);
  }

  @Get('settings')
  getSettings(
    @ReqContext() ctx: RequestContext,
  ): Promise<PrincipalNotificationSettings> {
    return this.preferencesService.getSettings(ctx.orgId, ctx.principalId);
  }

  @Put('settings')
  upsertSettings(
    @ReqContext() ctx: RequestContext,
    @Body() body: UpdatePrincipalNotificationSettingsRequest,
  ): Promise<PrincipalNotificationSettings> {
    return this.preferencesService.upsertSettings(
      ctx.orgId,
      ctx.principalId,
      body,
    );
  }
}
