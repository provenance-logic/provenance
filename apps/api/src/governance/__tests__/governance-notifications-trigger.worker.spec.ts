import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GovernanceNotificationsTriggerWorker } from '../governance-notifications-trigger.worker.js';
import { GracePeriodEntity } from '../entities/grace-period.entity.js';
import { DataProductEntity } from '../../products/entities/data-product.entity.js';
import { NotificationsService } from '../../notifications/notifications.service.js';

const ORG = 'org-1';
const PRODUCT = 'product-1';

function makeQb(rows: unknown[]) {
  return {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
}

describe('GovernanceNotificationsTriggerWorker', () => {
  let worker: GovernanceNotificationsTriggerWorker;
  let gracePeriodRepo: { createQueryBuilder: jest.Mock; update: jest.Mock };
  let productRepo: { findOne: jest.Mock };
  let notificationsService: { enqueue: jest.Mock };

  beforeEach(async () => {
    gracePeriodRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(makeQb([])),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    productRepo = { findOne: jest.fn() };
    notificationsService = { enqueue: jest.fn().mockResolvedValue([]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        GovernanceNotificationsTriggerWorker,
        { provide: getRepositoryToken(GracePeriodEntity), useValue: gracePeriodRepo },
        { provide: getRepositoryToken(DataProductEntity), useValue: productRepo },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    worker = moduleRef.get(GovernanceNotificationsTriggerWorker);
  });

  it('does nothing when no eligible grace periods', async () => {
    const count = await worker.runGracePeriodExpiring();
    expect(count).toBe(0);
    expect(notificationsService.enqueue).not.toHaveBeenCalled();
  });

  it('enqueues grace_period_expiring to product owner and stamps the row', async () => {
    const gp = {
      id: 'gp-1',
      orgId: ORG,
      productId: PRODUCT,
      policyDomain: 'product_schema',
      policyVersionId: 'pv-1',
      endsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    };
    gracePeriodRepo.createQueryBuilder.mockReturnValue(makeQb([gp]));
    productRepo.findOne.mockResolvedValue({
      id: PRODUCT,
      ownerPrincipalId: 'owner-1',
      name: 'Customer Events',
    });

    const count = await worker.runGracePeriodExpiring();

    expect(count).toBe(1);
    expect(notificationsService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG,
        category: 'grace_period_expiring',
        recipients: ['owner-1'],
        dedupKey: 'grace_period_expiring:gp-1',
      }),
    );
    expect(gracePeriodRepo.update).toHaveBeenCalledWith(
      { id: 'gp-1' },
      expect.objectContaining({ expiryWarningSentAt: expect.any(Date) }),
    );
    const enqueueArg = notificationsService.enqueue.mock.calls[0][0] as {
      payload: { daysRemaining: number };
    };
    expect(enqueueArg.payload.daysRemaining).toBeGreaterThanOrEqual(2);
    expect(enqueueArg.payload.daysRemaining).toBeLessThanOrEqual(4);
  });

  it('does not stamp the row when notification enqueue throws', async () => {
    const gp = {
      id: 'gp-1',
      orgId: ORG,
      productId: PRODUCT,
      policyDomain: 'product_schema',
      policyVersionId: 'pv-1',
      endsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    };
    gracePeriodRepo.createQueryBuilder.mockReturnValue(makeQb([gp]));
    productRepo.findOne.mockResolvedValue({
      id: PRODUCT,
      ownerPrincipalId: 'owner-1',
      name: 'X',
    });
    notificationsService.enqueue.mockRejectedValueOnce(new Error('boom'));

    const count = await worker.runGracePeriodExpiring();

    expect(count).toBe(0);
    expect(gracePeriodRepo.update).not.toHaveBeenCalled();
  });

  it('skips rows whose product no longer exists', async () => {
    const gp = {
      id: 'gp-orphan',
      orgId: ORG,
      productId: 'gone-product',
      policyDomain: 'product_schema',
      policyVersionId: 'pv-1',
      endsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    };
    gracePeriodRepo.createQueryBuilder.mockReturnValue(makeQb([gp]));
    productRepo.findOne.mockResolvedValue(null);

    const count = await worker.runGracePeriodExpiring();
    expect(count).toBe(0);
    expect(notificationsService.enqueue).not.toHaveBeenCalled();
  });

  it('runAll catches errors so cron does not crash the process', async () => {
    gracePeriodRepo.createQueryBuilder.mockImplementation(() => {
      throw new Error('query exploded');
    });
    await expect(worker.runAll()).resolves.not.toThrow();
  });
});
