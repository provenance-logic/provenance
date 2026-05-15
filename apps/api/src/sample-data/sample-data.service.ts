import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DomainEntity } from '../organizations/entities/domain.entity.js';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { PortDeclarationEntity } from '../products/entities/port-declaration.entity.js';
import { SloDeclarationEntity } from '../observability/entities/slo-declaration.entity.js';
import { NotificationEntity } from '../notifications/entities/notification.entity.js';

// B-027 — populates the calling org with a small demo workspace.
//
// Idempotent: every entity is looked up by natural key (org_id + slug
// for domain/product, etc.) before being created. Re-running the
// endpoint after the first successful call is a no-op.
//
// Deliberately bypasses parts of the production publish flow (governance
// pre-checks, Kafka lifecycle events) — the payload is authored, not
// user-supplied, and trying to satisfy the full publish flow makes the
// seed brittle to OPA / broker availability. Same trade-off the
// SeedController next door makes.
//
// Gate: DEMO_DATA_ENABLED env flag (read at call time, not boot time, so
// flipping it doesn't require a service restart). Returns 404 on the
// service side when disabled so probing attackers cannot detect the
// surface even with a valid org_admin token.

export interface PopulateSummary {
  created: {
    domains: number;
    products: number;
    ports: number;
    slos: number;
    notifications: number;
  };
  domainId: string;
  productIds: string[];
}

@Injectable()
export class SampleDataService {
  private readonly logger = new Logger(SampleDataService.name);

  constructor(
    @InjectRepository(DomainEntity)
    private readonly domainRepo: Repository<DomainEntity>,
    @InjectRepository(DataProductEntity)
    private readonly productRepo: Repository<DataProductEntity>,
    @InjectRepository(PortDeclarationEntity)
    private readonly portRepo: Repository<PortDeclarationEntity>,
    @InjectRepository(SloDeclarationEntity)
    private readonly sloRepo: Repository<SloDeclarationEntity>,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
  ) {}

  async populate(orgId: string, callerPrincipalId: string): Promise<PopulateSummary> {
    if (process.env['DEMO_DATA_ENABLED']?.toLowerCase() !== 'true') {
      throw new NotFoundException();
    }

    const created = { domains: 0, products: 0, ports: 0, slos: 0, notifications: 0 };

    // 1. Domain
    const domain = await this.findOrCreate(
      this.domainRepo,
      { orgId, slug: 'customer-data' },
      {
        orgId,
        slug: 'customer-data',
        name: 'Customer Data',
        description: 'Demo domain containing customer-related data products. Created by the wizard\'s sample-data button.',
        ownerPrincipalId: callerPrincipalId,
      },
      created,
      'domains',
    );

    // 2. Products
    const product360 = await this.findOrCreate(
      this.productRepo,
      { orgId, domainId: domain.id, slug: 'customer-360-view' },
      {
        orgId,
        domainId: domain.id,
        slug: 'customer-360-view',
        name: 'Customer 360 View',
        description: 'Unified per-customer record joining CRM, billing, and product-usage signals. Published.',
        status: 'published',
        version: '1.0.0',
        classification: 'internal',
        ownerPrincipalId: callerPrincipalId,
        tags: ['demo', 'customer', 'analytics'],
      },
      created,
      'products',
    );

    const productSegments = await this.findOrCreate(
      this.productRepo,
      { orgId, domainId: domain.id, slug: 'marketing-segments' },
      {
        orgId,
        domainId: domain.id,
        slug: 'marketing-segments',
        name: 'Marketing Segments',
        description: 'Customer cohort definitions used by campaign tooling. Still in draft — promote when the segmentation review lands.',
        status: 'draft',
        version: '0.1.0',
        classification: 'internal',
        ownerPrincipalId: callerPrincipalId,
        tags: ['demo', 'marketing'],
      },
      created,
      'products',
    );

    // 3. Output port on each product (so the products are non-empty in the UI)
    await this.findOrCreate(
      this.portRepo,
      { orgId, productId: product360.id, name: 'sql-view' },
      {
        orgId,
        productId: product360.id,
        portType: 'output',
        name: 'sql-view',
        description: 'JDBC view exposing the joined customer record.',
        interfaceType: 'sql_jdbc',
        contractSchema: {
          fields: [
            { name: 'customer_id', type: 'uuid', nullable: false },
            { name: 'email', type: 'string', nullable: false },
            { name: 'lifetime_value_usd', type: 'numeric', nullable: true },
            { name: 'last_activity_at', type: 'timestamp', nullable: true },
          ],
        },
        slaDescription: 'Freshness: under 4 hours; availability: 99.5%.',
        connectionDetails: { jdbc_url: 'jdbc:postgresql://demo-warehouse:5432/customer_360' },
        connectionDetailsValidated: false,
        connectionDetailsEncrypted: false,
      },
      created,
      'ports',
    );

    await this.findOrCreate(
      this.portRepo,
      { orgId, productId: productSegments.id, name: 'segment-export' },
      {
        orgId,
        productId: productSegments.id,
        portType: 'output',
        name: 'segment-export',
        description: 'Daily S3 export of segment memberships in Parquet.',
        interfaceType: 'file_object_export',
        contractSchema: {
          fields: [
            { name: 'customer_id', type: 'uuid', nullable: false },
            { name: 'segment_id', type: 'string', nullable: false },
            { name: 'assigned_at', type: 'timestamp', nullable: false },
          ],
        },
        slaDescription: 'Daily snapshot at 02:00 UTC.',
        connectionDetails: { s3_uri: 's3://demo-marketing/segments/' },
        connectionDetailsValidated: false,
        connectionDetailsEncrypted: false,
      },
      created,
      'ports',
    );

    // 4. SLO on the published product (freshness)
    await this.findOrCreate(
      this.sloRepo,
      { orgId, productId: product360.id, name: 'freshness-under-4h' },
      {
        orgId,
        productId: product360.id,
        name: 'freshness-under-4h',
        description: 'The latest event in the unified view is no more than 4 hours stale.',
        sloType: 'freshness',
        metricName: 'max_event_age_seconds',
        thresholdOperator: 'lte',
        thresholdValue: 14400,
        thresholdUnit: 'seconds',
        evaluationWindowHours: 24,
        externalSystem: null,
        active: true,
      },
      created,
      'slos',
    );

    // 5. Notifications to the caller — one for the populate event, one
    //    for the published product so the bell shows non-zero state.
    const populateDedup = `sample-data:populated:${orgId}`;
    await this.findOrCreate(
      this.notificationRepo,
      { orgId, recipientPrincipalId: callerPrincipalId, dedupKey: populateDedup },
      {
        orgId,
        recipientPrincipalId: callerPrincipalId,
        category: 'human_review_required',
        payload: {
          title: 'Sample workspace ready',
          body: 'A demo domain and two data products were created so the wizard has something to show. You can delete them anytime from the domain page.',
          domainId: domain.id,
        },
        deepLink: `/dashboard/${orgId}/domains/${domain.id}`,
        dedupKey: populateDedup,
        dedupCount: 1,
        readAt: null,
        dismissedAt: null,
      },
      created,
      'notifications',
    );

    const publishedDedup = `sample-data:published:${product360.id}`;
    await this.findOrCreate(
      this.notificationRepo,
      { orgId, recipientPrincipalId: callerPrincipalId, dedupKey: publishedDedup },
      {
        orgId,
        recipientPrincipalId: callerPrincipalId,
        category: 'product_published',
        payload: {
          title: 'Customer 360 View published',
          productId: product360.id,
          productSlug: product360.slug,
        },
        deepLink: `/dashboard/${orgId}/domains/${domain.id}/products/${product360.id}`,
        dedupKey: publishedDedup,
        dedupCount: 1,
        readAt: null,
        dismissedAt: null,
      },
      created,
      'notifications',
    );

    this.logger.log(
      `populate(${orgId}) by ${callerPrincipalId}: ${JSON.stringify(created)}`,
    );

    return {
      created,
      domainId: domain.id,
      productIds: [product360.id, productSegments.id],
    };
  }

  private async findOrCreate<T extends { id: string }>(
    repo: Repository<T>,
    where: Partial<T>,
    data: Partial<T>,
    counter: Record<string, number>,
    counterKey: string,
  ): Promise<T> {
    const existing = await repo.findOne({ where: where as never });
    if (existing) return existing;
    const entity = repo.create(data as never) as unknown as T;
    const created = (await repo.save(entity)) as unknown as T;
    counter[counterKey] = (counter[counterKey] ?? 0) + 1;
    return created;
  }
}
