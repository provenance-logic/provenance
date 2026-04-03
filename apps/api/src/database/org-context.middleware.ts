import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { DataSource } from 'typeorm';

/**
 * Sets the provenance.current_org_id PostgreSQL session variable on every request
 * so that row-level security policies can filter by organization.
 *
 * Must be applied after the JWT auth guard has populated req.user.
 */
@Injectable()
export class OrgContextMiddleware implements NestMiddleware {
  constructor(private readonly dataSource: DataSource) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const orgId = (req as Request & { user?: { orgId?: string } }).user?.orgId;
    if (orgId) {
      await this.dataSource.query(`SET LOCAL "provenance.current_org_id" = $1`, [orgId]);
    }
    next();
  }
}
