import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { HealthModule } from './health/health.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { ProductsModule } from './products/products.module.js';
import { OrgContextMiddleware } from './database/org-context.middleware.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    HealthModule,
    OrganizationsModule,
    ProductsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Apply org context middleware to all API routes so RLS works on every request.
    consumer.apply(OrgContextMiddleware).forRoutes('*');
  }
}
