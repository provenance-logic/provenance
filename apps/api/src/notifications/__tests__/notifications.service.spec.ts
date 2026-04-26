import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import type { EnqueueNotificationInput } from '@provenance/types';
import { NotificationsService } from '../notifications.service.js';
import { NotificationEntity } from '../entities/notification.entity.js';

const ORG_ID = 'org-1';
const PRINCIPAL_A = 'principal-a';
const PRINCIPAL_B = 'principal-b';

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
  const row: NotificationEntity = {
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
  return row;
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
      save: jest.fn().mockImplementation((v) =>
        Promise.resolve({
          ...v,
          id: v.id ?? 'notif-1',
          createdAt: v.createdAt ?? new Date('2026-04-26T12:00:00Z'),
          updatedAt: new Date('2026-04-26T12:00:00Z'),
        }),
      ),
      findOne: jest.fn(),
      increment: jest.fn().mockResolvedValue({ affected: 1 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getRepositoryToken(NotificationEntity), useValue: repo },
      ],
    }).compile();

    service = moduleRef.get(NotificationsService);
  });

  describe('enqueue', () => {
    it('writes one row per recipient when no dedup hit exists', async () => {
      qb.getOne.mockResolvedValue(null);

      const created = await service.enqueue(
        input({ recipients: [PRINCIPAL_A, PRINCIPAL_B] }),
      );

      expect(created).toHaveLength(2);
      expect(repo.save).toHaveBeenCalledTimes(2);
      expect(created[0].recipientPrincipalId).toBe(PRINCIPAL_A);
      expect(created[1].recipientPrincipalId).toBe(PRINCIPAL_B);
      expect(created.every((n) => n.dedupCount === 1)).toBe(true);
    });

    it('returns an empty array and writes nothing when recipients is empty', async () => {
      const created = await service.enqueue(input({ recipients: [] }));
      expect(created).toEqual([]);
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('bumps dedup_count on the existing row instead of inserting when a recent duplicate exists', async () => {
      const existing = makeRow({ id: 'existing-1', dedupCount: 1 });
      qb.getOne.mockResolvedValue(existing);

      const created = await service.enqueue(input());

      expect(created).toHaveLength(1);
      expect(created[0].id).toBe('existing-1');
      expect(repo.increment).toHaveBeenCalledWith({ id: 'existing-1' }, 'dedupCount', 1);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('creates a new row when the only matching dedup_key is older than the dedup window', async () => {
      // The service queries for rows newer than (now - dedupWindow); any row
      // older than that does not match the query, so getOne returns null.
      qb.getOne.mockResolvedValue(null);

      const created = await service.enqueue(input());

      expect(created).toHaveLength(1);
      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(created[0].dedupCount).toBe(1);
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
      // Window predicate uses createdAt >= some cutoff
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
      // The service must scope its lookup by recipientPrincipalId, so the row
      // appears not to exist from the caller's perspective.
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
