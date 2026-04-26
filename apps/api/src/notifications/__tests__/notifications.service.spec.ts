import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import type {
  EnqueueNotificationInput,
  NotificationPreference,
} from '@provenance/types';
import { NotificationsService } from '../notifications.service.js';
import { NotificationEntity } from '../entities/notification.entity.js';
import { NotificationDeliveryOutboxEntity } from '../entities/notification-delivery-outbox.entity.js';
import { PrincipalEntity } from '../../organizations/entities/principal.entity.js';
import {
  NotificationPreferencesService,
  preferenceKey,
} from '../notification-preferences.service.js';

const ORG_ID = 'org-1';
const PRINCIPAL_A = 'principal-a';
const PRINCIPAL_B = 'principal-b';
const PRINCIPAL_NO_EMAIL = 'principal-no-email';

function input(overrides: Partial<EnqueueNotificationInput> = {}): EnqueueNotificationInput {
  return {
    orgId: ORG_ID,
    category: 'slo_violation',
    recipients: [PRINCIPAL_A],
    payload: { productId: 'product-1', sloType: 'freshness' },
    deepLink: '/products/product-1/observability',
    dedupKey: 'slo_violation:product-1:freshness',
    ...overrides,
  };
}

function makeRow(overrides: Partial<NotificationEntity> = {}): NotificationEntity {
  return {
    id: overrides.id ?? 'notif-1',
    orgId: ORG_ID,
    recipientPrincipalId: PRINCIPAL_A,
    category: 'slo_violation',
    payload: { productId: 'product-1' },
    deepLink: '/products/product-1/observability',
    dedupKey: 'slo_violation:product-1:freshness',
    dedupCount: 1,
    readAt: null,
    dismissedAt: null,
    createdAt: new Date('2026-04-26T12:00:00Z'),
    updatedAt: new Date('2026-04-26T12:00:00Z'),
    ...overrides,
  };
}

function makePrincipal(overrides: Partial<PrincipalEntity> = {}): PrincipalEntity {
  return {
    id: PRINCIPAL_A,
    orgId: ORG_ID,
    principalType: 'human_user',
    keycloakSubject: `kc-${overrides.id ?? PRINCIPAL_A}`,
    email: 'principal-a@example.com',
    displayName: 'Principal A',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    increment: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let qb: {
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    take: jest.Mock;
    skip: jest.Mock;
    getOne: jest.Mock;
    getManyAndCount: jest.Mock;
  };
  let principalRepo: { find: jest.Mock };
  let preferences: {
    loadByRecipients: jest.Mock;
    loadWebhookUrls: jest.Mock;
  };
  let txnNotifRepo: { create: jest.Mock; save: jest.Mock };
  let txnOutboxRepo: { create: jest.Mock; save: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    repo = {
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn(),
      findOne: jest.fn(),
      increment: jest.fn().mockResolvedValue({ affected: 1 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };

    principalRepo = {
      find: jest.fn().mockResolvedValue([makePrincipal()]),
    };

    // Default: no per-principal preferences saved → resolver falls back to
    // CATEGORY_DEFAULT_CHANNELS for every recipient. Tests that exercise
    // preference branches override this on a case-by-case basis.
    preferences = {
      loadByRecipients: jest.fn().mockResolvedValue(new Map<string, NotificationPreference>()),
      loadWebhookUrls: jest.fn().mockResolvedValue(new Map<string, string>()),
    };

    txnNotifRepo = {
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockImplementation((v) =>
        Promise.resolve({
          ...v,
          id: v.id ?? 'notif-1',
          createdAt: v.createdAt ?? new Date('2026-04-26T12:00:00Z'),
          updatedAt: new Date('2026-04-26T12:00:00Z'),
        }),
      ),
    };
    txnOutboxRepo = {
      create: jest.fn().mockImplementation((v) => v),
      save: jest.fn().mockResolvedValue(undefined),
    };

    const entityManager = {
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === NotificationEntity) return txnNotifRepo;
        if (entity === NotificationDeliveryOutboxEntity) return txnOutboxRepo;
        throw new Error(`Unexpected repository for ${String(entity)}`);
      }),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation((cb) => cb(entityManager)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getRepositoryToken(NotificationEntity), useValue: repo },
        { provide: getRepositoryToken(PrincipalEntity), useValue: principalRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: NotificationPreferencesService, useValue: preferences },
      ],
    }).compile();

    service = moduleRef.get(NotificationsService);
  });

  describe('enqueue', () => {
    it('writes one notification row per recipient when no dedup hit exists', async () => {
      qb.getOne.mockResolvedValue(null);
      principalRepo.find.mockResolvedValue([
        makePrincipal({ id: PRINCIPAL_A, email: 'a@example.com' }),
        makePrincipal({ id: PRINCIPAL_B, email: 'b@example.com' }),
      ]);

      const created = await service.enqueue(
        input({ recipients: [PRINCIPAL_A, PRINCIPAL_B] }),
      );

      expect(created).toHaveLength(2);
      expect(txnNotifRepo.save).toHaveBeenCalledTimes(2);
      expect(created[0].recipientPrincipalId).toBe(PRINCIPAL_A);
      expect(created[1].recipientPrincipalId).toBe(PRINCIPAL_B);
      expect(created.every((n) => n.dedupCount === 1)).toBe(true);
    });

    it('returns an empty array and writes nothing when recipients is empty', async () => {
      const created = await service.enqueue(input({ recipients: [] }));
      expect(created).toEqual([]);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(principalRepo.find).not.toHaveBeenCalled();
    });

    it('writes an email outbox row for a category whose default channels include email', async () => {
      qb.getOne.mockResolvedValue(null);
      principalRepo.find.mockResolvedValue([
        makePrincipal({ id: PRINCIPAL_A, email: 'a@example.com' }),
      ]);

      await service.enqueue(input({ category: 'slo_violation' }));

      expect(txnOutboxRepo.save).toHaveBeenCalledTimes(1);
      const outboxArg = txnOutboxRepo.create.mock.calls[0][0];
      expect(outboxArg.channel).toBe('email');
      expect(outboxArg.target).toBe('a@example.com');
      expect(outboxArg.category).toBe('slo_violation');
      expect(outboxArg.deepLink).toBe('/products/product-1/observability');
      expect(outboxArg.payload).toEqual({
        productId: 'product-1',
        sloType: 'freshness',
      });
      expect(outboxArg.attemptCount).toBe(0);
    });

    it('writes no outbox rows for in-platform-only categories', async () => {
      qb.getOne.mockResolvedValue(null);
      // Even with email available, product_published is in_platform-only by default
      principalRepo.find.mockResolvedValue([
        makePrincipal({ id: PRINCIPAL_A, email: 'a@example.com' }),
      ]);

      await service.enqueue(input({ category: 'product_published' }));

      expect(txnNotifRepo.save).toHaveBeenCalledTimes(1);
      expect(txnOutboxRepo.save).not.toHaveBeenCalled();
    });

    it('skips the email outbox row for principals with no email on file', async () => {
      qb.getOne.mockResolvedValue(null);
      principalRepo.find.mockResolvedValue([
        makePrincipal({ id: PRINCIPAL_NO_EMAIL, email: null }),
      ]);

      await service.enqueue(
        input({ category: 'slo_violation', recipients: [PRINCIPAL_NO_EMAIL] }),
      );

      // The notification row is still written (in-platform delivery still works);
      // only the email outbox row is skipped.
      expect(txnNotifRepo.save).toHaveBeenCalledTimes(1);
      expect(txnOutboxRepo.save).not.toHaveBeenCalled();
    });

    it('does not query principals when no out-of-band channels are needed', async () => {
      qb.getOne.mockResolvedValue(null);
      await service.enqueue(input({ category: 'product_published' }));
      expect(principalRepo.find).not.toHaveBeenCalled();
    });

    it('bumps dedup_count on the existing row instead of inserting when a recent duplicate exists', async () => {
      const existing = makeRow({ id: 'existing-1', dedupCount: 1 });
      qb.getOne.mockResolvedValue(existing);

      const created = await service.enqueue(input());

      expect(created).toHaveLength(1);
      expect(created[0].id).toBe('existing-1');
      expect(repo.increment).toHaveBeenCalledWith({ id: 'existing-1' }, 'dedupCount', 1);
      // No new notification row, and no email — dedup suppression covers
      // downstream channels too.
      expect(txnNotifRepo.save).not.toHaveBeenCalled();
      expect(txnOutboxRepo.save).not.toHaveBeenCalled();
    });

    it('skips the email outbox row when the recipient has opted out of the category', async () => {
      qb.getOne.mockResolvedValue(null);
      principalRepo.find.mockResolvedValue([
        makePrincipal({ id: PRINCIPAL_A, email: 'a@example.com' }),
      ]);
      preferences.loadByRecipients.mockResolvedValue(
        new Map([
          [
            preferenceKey(PRINCIPAL_A, 'slo_violation'),
            {
              orgId: ORG_ID,
              principalId: PRINCIPAL_A,
              category: 'slo_violation',
              enabled: false,
              channels: [],
              updatedAt: '2026-04-26T12:00:00Z',
            } as NotificationPreference,
          ],
        ]),
      );

      await service.enqueue(input({ category: 'slo_violation' }));

      // In-platform row still written (resolver always retains in_platform).
      expect(txnNotifRepo.save).toHaveBeenCalledTimes(1);
      // No email outbox row — opt-out collapsed channels to in_platform only.
      expect(txnOutboxRepo.save).not.toHaveBeenCalled();
    });

    it('honors a channel override when one is set on the preference', async () => {
      qb.getOne.mockResolvedValue(null);
      principalRepo.find.mockResolvedValue([
        makePrincipal({ id: PRINCIPAL_A, email: 'a@example.com' }),
      ]);
      // product_published is in_platform-only by default. The principal here
      // has overridden it to include email — confirm the outbox row appears.
      preferences.loadByRecipients.mockResolvedValue(
        new Map([
          [
            preferenceKey(PRINCIPAL_A, 'product_published'),
            {
              orgId: ORG_ID,
              principalId: PRINCIPAL_A,
              category: 'product_published',
              enabled: true,
              channels: ['email'],
              updatedAt: '2026-04-26T12:00:00Z',
            } as NotificationPreference,
          ],
        ]),
      );

      await service.enqueue(input({ category: 'product_published' }));

      expect(txnOutboxRepo.save).toHaveBeenCalledTimes(1);
      expect(txnOutboxRepo.create.mock.calls[0][0].channel).toBe('email');
    });

    it('writes a webhook outbox row when the principal has a configured URL and override', async () => {
      qb.getOne.mockResolvedValue(null);
      principalRepo.find.mockResolvedValue([
        makePrincipal({ id: PRINCIPAL_A, email: 'a@example.com' }),
      ]);
      preferences.loadByRecipients.mockResolvedValue(
        new Map([
          [
            preferenceKey(PRINCIPAL_A, 'product_published'),
            {
              orgId: ORG_ID,
              principalId: PRINCIPAL_A,
              category: 'product_published',
              enabled: true,
              channels: ['webhook'],
              updatedAt: '2026-04-26T12:00:00Z',
            } as NotificationPreference,
          ],
        ]),
      );
      preferences.loadWebhookUrls.mockResolvedValue(
        new Map([[PRINCIPAL_A, 'https://hooks.example.com/abc']]),
      );

      await service.enqueue(input({ category: 'product_published' }));

      const webhookRow = txnOutboxRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { channel: string }).channel === 'webhook',
      );
      expect(webhookRow).toBeDefined();
      expect((webhookRow![0] as { target: string }).target).toBe(
        'https://hooks.example.com/abc',
      );
    });

    it('skips webhook outbox row when principal has no webhook URL on file', async () => {
      qb.getOne.mockResolvedValue(null);
      principalRepo.find.mockResolvedValue([
        makePrincipal({ id: PRINCIPAL_A, email: 'a@example.com' }),
      ]);
      preferences.loadByRecipients.mockResolvedValue(
        new Map([
          [
            preferenceKey(PRINCIPAL_A, 'product_published'),
            {
              orgId: ORG_ID,
              principalId: PRINCIPAL_A,
              category: 'product_published',
              enabled: true,
              channels: ['webhook'],
              updatedAt: '2026-04-26T12:00:00Z',
            } as NotificationPreference,
          ],
        ]),
      );
      preferences.loadWebhookUrls.mockResolvedValue(new Map());

      await service.enqueue(input({ category: 'product_published' }));

      // In-platform row still written; no webhook row because no URL.
      expect(txnNotifRepo.save).toHaveBeenCalledTimes(1);
      const webhookRow = txnOutboxRepo.create.mock.calls.find(
        (c: unknown[]) => (c[0] as { channel: string }).channel === 'webhook',
      );
      expect(webhookRow).toBeUndefined();
    });

    it('does not query webhook URLs when no resolved channel includes webhook', async () => {
      qb.getOne.mockResolvedValue(null);
      // Default category default channels for slo_violation is in_platform + email,
      // not webhook — so loadWebhookUrls should not be called.
      await service.enqueue(input({ category: 'slo_violation' }));
      expect(preferences.loadWebhookUrls).not.toHaveBeenCalled();
    });

    it('still delivers governance-mandatory categories at in_platform even when opted out', async () => {
      qb.getOne.mockResolvedValue(null);
      principalRepo.find.mockResolvedValue([
        makePrincipal({ id: PRINCIPAL_A, email: 'a@example.com' }),
      ]);
      preferences.loadByRecipients.mockResolvedValue(
        new Map([
          [
            preferenceKey(PRINCIPAL_A, 'frozen_operation_disposition'),
            {
              orgId: ORG_ID,
              principalId: PRINCIPAL_A,
              category: 'frozen_operation_disposition',
              enabled: false,
              channels: [],
              updatedAt: '2026-04-26T12:00:00Z',
            } as NotificationPreference,
          ],
        ]),
      );

      await service.enqueue(input({ category: 'frozen_operation_disposition' }));

      // The notification still lands in the inbox; governance-mandatory
      // can't be fully suppressed.
      expect(txnNotifRepo.save).toHaveBeenCalledTimes(1);
      // Email is stripped though — out-of-band channels honor the opt-out.
      expect(txnOutboxRepo.save).not.toHaveBeenCalled();
    });

    it('looks up dedup matches scoped by org, recipient, category, and dedup_key', async () => {
      qb.getOne.mockResolvedValue(null);

      await service.enqueue(input({ recipients: [PRINCIPAL_A] }));

      expect(qb.where).toHaveBeenCalledWith('n.orgId = :orgId', { orgId: ORG_ID });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'n.recipientPrincipalId = :recipientPrincipalId',
        { recipientPrincipalId: PRINCIPAL_A },
      );
      expect(qb.andWhere).toHaveBeenCalledWith('n.category = :category', {
        category: 'slo_violation',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('n.dedupKey = :dedupKey', {
        dedupKey: 'slo_violation:product-1:freshness',
      });
      const calls = qb.andWhere.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls).toContain('n.createdAt >= :since');
    });
  });

  describe('list', () => {
    it('filters by org and recipient and orders most-recent-first', async () => {
      await service.list(ORG_ID, PRINCIPAL_A, { limit: 20, offset: 0 });

      expect(qb.where).toHaveBeenCalledWith('n.orgId = :orgId', { orgId: ORG_ID });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'n.recipientPrincipalId = :recipientPrincipalId',
        { recipientPrincipalId: PRINCIPAL_A },
      );
      expect(qb.orderBy).toHaveBeenCalledWith('n.createdAt', 'DESC');
      expect(qb.take).toHaveBeenCalledWith(20);
      expect(qb.skip).toHaveBeenCalledWith(0);
    });

    it('excludes dismissed notifications by default', async () => {
      await service.list(ORG_ID, PRINCIPAL_A, { limit: 20, offset: 0 });
      const calls = qb.andWhere.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls).toContain('n.dismissedAt IS NULL');
    });

    it('includes dismissed notifications when excludeDismissed is false', async () => {
      await service.list(ORG_ID, PRINCIPAL_A, {
        limit: 20,
        offset: 0,
        excludeDismissed: false,
      });
      const calls = qb.andWhere.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls).not.toContain('n.dismissedAt IS NULL');
    });

    it('filters by category when supplied', async () => {
      await service.list(ORG_ID, PRINCIPAL_A, {
        limit: 20,
        offset: 0,
        category: 'slo_violation',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('n.category = :category', {
        category: 'slo_violation',
      });
    });

    it('filters by unread when unreadOnly is true', async () => {
      await service.list(ORG_ID, PRINCIPAL_A, {
        limit: 20,
        offset: 0,
        unreadOnly: true,
      });
      const calls = qb.andWhere.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls).toContain('n.readAt IS NULL');
    });
  });

  describe('markRead', () => {
    it('sets readAt on a notification owned by the caller', async () => {
      const row = makeRow({ id: 'notif-2', readAt: null });
      repo.findOne.mockResolvedValue(row);

      const result = await service.markRead(ORG_ID, PRINCIPAL_A, 'notif-2');

      expect(repo.update).toHaveBeenCalledWith(
        { id: 'notif-2' },
        expect.objectContaining({ readAt: expect.any(Date) }),
      );
      expect(result.id).toBe('notif-2');
    });

    it('does not overwrite an existing readAt timestamp (idempotent)', async () => {
      const alreadyRead = new Date('2026-04-26T11:00:00Z');
      const row = makeRow({ id: 'notif-3', readAt: alreadyRead });
      repo.findOne.mockResolvedValue(row);

      const result = await service.markRead(ORG_ID, PRINCIPAL_A, 'notif-3');

      expect(repo.update).not.toHaveBeenCalled();
      expect(result.readAt).toEqual(alreadyRead.toISOString());
    });

    it('throws NotFoundException when the notification belongs to another principal', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.markRead(ORG_ID, PRINCIPAL_A, 'someone-elses-notif'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(repo.findOne).toHaveBeenCalledWith({
        where: {
          id: 'someone-elses-notif',
          orgId: ORG_ID,
          recipientPrincipalId: PRINCIPAL_A,
        },
      });
    });
  });

  describe('dismiss', () => {
    it('sets dismissedAt on a notification owned by the caller', async () => {
      const row = makeRow({ id: 'notif-4', dismissedAt: null });
      repo.findOne.mockResolvedValue(row);

      const result = await service.dismiss(ORG_ID, PRINCIPAL_A, 'notif-4');

      expect(repo.update).toHaveBeenCalledWith(
        { id: 'notif-4' },
        expect.objectContaining({ dismissedAt: expect.any(Date) }),
      );
      expect(result.id).toBe('notif-4');
    });

    it('is idempotent on already-dismissed notifications', async () => {
      const alreadyDismissed = new Date('2026-04-26T11:30:00Z');
      const row = makeRow({ id: 'notif-5', dismissedAt: alreadyDismissed });
      repo.findOne.mockResolvedValue(row);

      const result = await service.dismiss(ORG_ID, PRINCIPAL_A, 'notif-5');

      expect(repo.update).not.toHaveBeenCalled();
      expect(result.dismissedAt).toEqual(alreadyDismissed.toISOString());
    });

    it('throws NotFoundException when the notification belongs to another principal', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(
        service.dismiss(ORG_ID, PRINCIPAL_A, 'someone-elses-notif'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
