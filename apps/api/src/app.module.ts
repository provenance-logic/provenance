import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from './common/common.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { HealthModule } from './health/health.module.js';
import { DocsModule } from './docs/docs.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { ProductsModule } from './products/products.module.js';
import { GovernanceModule } from './governance/governance.module.js';
import { ConnectorsModule } from './connectors/connectors.module.js';
import { SearchModule } from './search/search.module.js';
import { AccessModule } from './access/access.module.js';
import { ConsentModule } from './consent/consent.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { LineageModule } from './lineage/lineage.module.js';
import { ObservabilityModule } from './observability/observability.module.js';
import { TrustScoreModule } from './trust-score/trust-score.module.js';
import { AgentsModule } from './agents/agents.module.js';
import { OrgContextMiddleware } from './database/org-context.middleware.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    CommonModule,
    DatabaseModule,
    AuthModule,
    HealthModule,
    DocsModule,
    OrganizationsModule,
    ProductsModule,
    GovernanceModule,
    ConnectorsModule,
    SearchModule,
    AccessModule,
    ConsentModule,
    NotificationsModule,
    LineageModule,
    ObservabilityModule,
    TrustScoreModule,
    AgentsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Apply org context middleware to all API routes so RLS works on every request.
    consumer.apply(OrgContextMiddleware).forRoutes('*');
  }
}
