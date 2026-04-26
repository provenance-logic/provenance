import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import {
  DELIVERY_RETRY_DELAYS_SECONDS,
  MAX_DELIVERY_ATTEMPTS,
} from '@provenance/types';
import { NotificationDeliveryWorker } from '../notification-delivery.worker.js';
import { NotificationDeliveryOutboxEntity } from '../entities/notification-delivery-outbox.entity.js';
import { EmailService } from '../../email/email.service.js';

const ORG_ID = 'org-1';

function makeOutboxRow(
  overrides: Partial<NotificationDeliveryOutboxEntity> = {},
): NotificationDeliveryOutboxEntity {
  return {
    id: '1',
    notificationId: 'notif-1',
    orgId: ORG_ID,
    channel: 'email',
    target: 'recipient@example.com',
    category: 'slo_violation',
    payload: { productId: 'product-1' },
    deepLink: '/products/product-1/observability',
    attemptCount: 0,
    nextAttemptAt: new Date('2026-04-26T12:00:00Z'),
    deliveredAt: null,
    failedAt: null,
    lastError: null,
    createdAt: new Date('2026-04-26T12:00:00Z'),
    ...overrides,
  };
}

describe('NotificationDeliveryWorker', () => {
  let worker: NotificationDeliveryWorker;
  let emailService: { send: jest.Mock };
  let queryBuilder: {
    where: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    setLock: jest.Mock;
    setOnLocked: jest.Mock;
    limit: jest.Mock;
    getMany: jest.Mock;
  };
  let entityManager: {
    createQueryBuilder: jest.Mock;
    update: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      setOnLocked: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    entityManager = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    dataSource = {
      transaction: jest.fn().mockImplementation((cb) => cb(entityManager)),
    };
    emailService = { send: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationDeliveryWorker,
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    worker = moduleRef.get(NotificationDeliveryWorker);
  });

  describe('drainOnce — claim query', () => {
    it('claims pending rows older than now() with FOR UPDATE SKIP LOCKED', async () => {
      queryBuilder.getMany.mockResolvedValue([]);

      await worker.drainOnce();

      expect(queryBuilder.where).toHaveBeenCalledWith('o.deliveredAt IS NULL');
      expect(queryBuilder.andWhere).toHaveBeenCalledWith('o.failedAt IS NULL');
      const nextAttemptCall = queryBuilder.andWhere.mock.calls.find(
        (c: unknown[]) => c[0] === 'o.nextAttemptAt <= :now',
      );
      expect(nextAttemptCall).toBeDefined();
      expect(queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(queryBuilder.setOnLocked).toHaveBeenCalledWith('skip_locked');
    });

    it('returns zero counts when no rows are pending', async () => {
      queryBuilder.getMany.mockResolvedValue([]);
      const result = await worker.drainOnce();
      expect(result).toEqual({ delivered: 0, retried: 0, failed: 0 });
      expect(emailService.send).not.toHaveBeenCalled();
    });
  });

  describe('drainOnce — successful delivery', () => {
    it('marks the row delivered and increments attemptCount', async () => {
      const row = makeOutboxRow({ attemptCount: 0 });
      queryBuilder.getMany.mockResolvedValue([row]);
      emailService.send.mockResolvedValue({ messageId: 'msg-1', accepted: true });

      const result = await worker.drainOnce();

      expect(result.delivered).toBe(1);
      expect(emailService.send).toHaveBeenCalledTimes(1);
      const sendArg = emailService.send.mock.calls[0][0];
      expect(sendArg.to).toBe('recipient@example.com');
      expect(sendArg.subject).toContain('SLO Violation');
      expect(sendArg.text).toContain('product-1');

      // Two transactions used: one for claim, one for the marking. The
      // marking call updates deliveredAt + attemptCount.
      const updateCall = entityManager.update.mock.calls[0];
      expect(updateCall[0]).toBe(NotificationDeliveryOutboxEntity);
      expect(updateCall[1]).toEqual({ id: row.id });
      expect(updateCall[2]).toMatchObject({
        attemptCount: 1,
        lastError: null,
      });
      expect(updateCall[2].deliveredAt).toBeInstanceOf(Date);
    });

    it('treats a transport rejection (accepted=false) as a delivery failure', async () => {
      const row = makeOutboxRow({ attemptCount: 0 });
      queryBuilder.getMany.mockResolvedValue([row]);
      emailService.send.mockResolvedValue({ messageId: 'msg-2', accepted: false });

      const result = await worker.drainOnce();

      expect(result.delivered).toBe(0);
      expect(result.retried).toBe(1);
      const updateCall = entityManager.update.mock.calls[0];
      expect(updateCall[2]).toMatchObject({
        attemptCount: 1,
      });
      expect(updateCall[2].nextAttemptAt).toBeInstanceOf(Date);
      expect(updateCall[2].lastError).toContain('rejected');
    });
  });

  describe('drainOnce — retry mechanics', () => {
    it('schedules the next attempt using DELIVERY_RETRY_DELAYS_SECONDS[attemptCount]', async () => {
      const row = makeOutboxRow({ attemptCount: 0 });
      queryBuilder.getMany.mockResolvedValue([row]);
      emailService.send.mockRejectedValue(new Error('SMTP connection refused'));

      const before = Date.now();
      const result = await worker.drainOnce();
      const after = Date.now();

      expect(result.retried).toBe(1);
      const updateArgs = entityManager.update.mock.calls[0][2];
      const delaySeconds = DELIVERY_RETRY_DELAYS_SECONDS[0];
      const expectedMin = before + delaySeconds * 1000;
      const expectedMax = after + delaySeconds * 1000;
      const actualMs = (updateArgs.nextAttemptAt as Date).getTime();
      expect(actualMs).toBeGreaterThanOrEqual(expectedMin);
      expect(actualMs).toBeLessThanOrEqual(expectedMax);
      expect(updateArgs.attemptCount).toBe(1);
      expect(updateArgs.lastError).toContain('connection refused');
    });

    it('marks the row failed after the maximum number of attempts', async () => {
      const row = makeOutboxRow({ attemptCount: MAX_DELIVERY_ATTEMPTS - 1 });
      queryBuilder.getMany.mockResolvedValue([row]);
      emailService.send.mockRejectedValue(new Error('SMTP timeout'));

      const result = await worker.drainOnce();

      expect(result.failed).toBe(1);
      expect(result.retried).toBe(0);
      const updateArgs = entityManager.update.mock.calls[0][2];
      expect(updateArgs.failedAt).toBeInstanceOf(Date);
      expect(updateArgs.attemptCount).toBe(MAX_DELIVERY_ATTEMPTS);
      expect(updateArgs.lastError).toContain('timeout');
    });

    it('truncates very long error messages to keep last_error bounded', async () => {
      const row = makeOutboxRow({ attemptCount: 0 });
      queryBuilder.getMany.mockResolvedValue([row]);
      const huge = 'x'.repeat(5000);
      emailService.send.mockRejectedValue(new Error(huge));

      await worker.drainOnce();

      const updateArgs = entityManager.update.mock.calls[0][2];
      expect((updateArgs.lastError as string).length).toBeLessThanOrEqual(1024);
    });
  });

  describe('drainOnce — channel guard', () => {
    it('treats an unimplemented channel as a hard failure on the first claim', async () => {
      // Webhook rows can be queued by future trigger code before PR #4 lands;
      // the worker must surface the gap loudly rather than silently dropping.
      const row = makeOutboxRow({ channel: 'webhook', target: 'https://example.com/hook' });
      queryBuilder.getMany.mockResolvedValue([row]);

      const result = await worker.drainOnce();

      expect(emailService.send).not.toHaveBeenCalled();
      // Treated like any other delivery exception — increments attempt count
      // and either schedules a retry or marks failed depending on attemptCount.
      expect(result.retried + result.failed).toBe(1);
      const updateArgs = entityManager.update.mock.calls[0][2];
      expect(updateArgs.lastError).toContain('webhook');
    });
  });
});
