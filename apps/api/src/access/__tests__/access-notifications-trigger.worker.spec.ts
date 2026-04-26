import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AccessNotificationsTriggerWorker } from '../access-notifications-trigger.worker.js';
import { AccessRequestEntity } from '../entities/access-request.entity.js';
import { AccessGrantEntity } from '../entities/access-grant.entity.js';
import { DataProductEntity } from '../../products/entities/data-product.entity.js';
import { RoleAssignmentEntity } from '../../organizations/entities/role-assignment.entity.js';
import { NotificationsService } from '../../notifications/notifications.service.js';

const ORG = 'org-1';
const PRODUCT = 'product-1';
const OWNER = 'owner-1';

function makeQb(rows: unknown[]) {
  return {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
}

describe('AccessNotificationsTriggerWorker', () => {
  let worker: AccessNotificationsTriggerWorker;
  let requestRepo: { createQueryBuilder: jest.Mock; update: jest.Mock };
  let grantRepo: { createQueryBuilder: jest.Mock; update: jest.Mock };
  let productRepo: { findOne: jest.Mock };
  let roleRepo: { find: jest.Mock };
  let notificationsService: { enqueue: jest.Mock };

  beforeEach(async () => {
    requestRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(makeQb([])),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    grantRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(makeQb([])),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    productRepo = { findOne: jest.fn() };
    roleRepo = { find: jest.fn().mockResolvedValue([]) };
    notificationsService = { enqueue: jest.fn().mockResolvedValue([]) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AccessNotificationsTriggerWorker,
        { provide: getRepositoryToken(AccessRequestEntity), useValue: requestRepo },
        { provide: getRepositoryToken(AccessGrantEntity), useValue: grantRepo },
        { provide: getRepositoryToken(DataProductEntity), useValue: productRepo },
        { provide: getRepositoryToken(RoleAssignmentEntity), useValue: roleRepo },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    worker = moduleRef.get(AccessNotificationsTriggerWorker);
  });

  describe('runSlaWarning (F11.9)', () => {
    it('does nothing when no requests are eligible', async () => {
      const count = await worker.runSlaWarning();
      expect(count).toBe(0);
      expect(notificationsService.enqueue).not.toHaveBeenCalled();
    });

    it('enqueues sla_warning to product owner and stamps the row when eligible', async () => {
      const request = {
        id: 'req-1',
        orgId: ORG,
        productId: PRODUCT,
        requestedAt: new Date('2026-04-25T00:00:00Z'),
      };
      requestRepo.createQueryBuilder.mockReturnValue(makeQb([request]));
      productRepo.findOne.mockResolvedValue({
        id: PRODUCT,
        ownerPrincipalId: OWNER,
        name: 'Customer Events',
      });

      const count = await worker.runSlaWarning();

      expect(count).toBe(1);
      expect(notificationsService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: ORG,
          category: 'access_request_sla_warning',
          recipients: [OWNER],
          dedupKey: 'access_request_sla_warning:req-1',
        }),
      );
      // Idempotency stamp set so the next cron pass skips this row.
      expect(requestRepo.update).toHaveBeenCalledWith(
        { id: 'req-1' },
        expect.objectContaining({ slaWarningSentAt: expect.any(Date) }),
      );
    });

    it('does not stamp the row when notification enqueue throws', async () => {
      const request = {
        id: 'req-1',
        orgId: ORG,
        productId: PRODUCT,
        requestedAt: new Date('2026-04-25T00:00:00Z'),
      };
      requestRepo.createQueryBuilder.mockReturnValue(makeQb([request]));
      productRepo.findOne.mockResolvedValue({
        id: PRODUCT,
        ownerPrincipalId: OWNER,
        name: 'Events',
      });
      notificationsService.enqueue.mockRejectedValueOnce(new Error('boom'));

      const count = await worker.runSlaWarning();

      expect(count).toBe(0);
      // Critical: row not stamped → next cron pass retries the notification.
      expect(requestRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('runSlaBreach (F11.10)', () => {
    it('enqueues sla_breach to owner + governance and stamps the row', async () => {
      const request = {
        id: 'req-2',
        orgId: ORG,
        productId: PRODUCT,
        requestedAt: new Date('2026-04-20T00:00:00Z'),
      };
      requestRepo.createQueryBuilder.mockReturnValue(makeQb([request]));
      productRepo.findOne.mockResolvedValue({
        id: PRODUCT,
        ownerPrincipalId: OWNER,
        name: 'Customer Events',
      });
      roleRepo.find.mockResolvedValue([
        { principalId: 'gov-1' },
        { principalId: 'gov-2' },
      ]);

      const count = await worker.runSlaBreach();

      expect(count).toBe(1);
      const enqueueArg = notificationsService.enqueue.mock.calls[0][0];
      expect(enqueueArg.category).toBe('access_request_sla_breach');
      expect(enqueueArg.recipients.sort()).toEqual([OWNER, 'gov-1', 'gov-2'].sort());
      expect(enqueueArg.dedupKey).toBe('access_request_sla_breach:req-2');
      expect(requestRepo.update).toHaveBeenCalledWith(
        { id: 'req-2' },
        expect.objectContaining({ slaBreachNotifiedAt: expect.any(Date) }),
      );
    });

    it('deduplicates owner if they are also a governance member', async () => {
      const request = {
        id: 'req-3',
        orgId: ORG,
        productId: PRODUCT,
        requestedAt: new Date('2026-04-20T00:00:00Z'),
      };
      requestRepo.createQueryBuilder.mockReturnValue(makeQb([request]));
      productRepo.findOne.mockResolvedValue({
        id: PRODUCT,
        ownerPrincipalId: OWNER,
        name: 'X',
      });
      roleRepo.find.mockResolvedValue([{ principalId: OWNER }, { principalId: 'gov-1' }]);

      await worker.runSlaBreach();

      const recipients = notificationsService.enqueue.mock.calls[0][0].recipients as string[];
      expect(recipients.filter((r) => r === OWNER)).toHaveLength(1);
    });
  });

  describe('runGrantExpiry (F11.11)', () => {
    it('enqueues access_grant_expiring to grantee and stamps the grant', async () => {
      const grant = {
        id: 'grant-1',
        orgId: ORG,
        productId: PRODUCT,
        granteePrincipalId: 'consumer-1',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };
      grantRepo.createQueryBuilder.mockReturnValue(makeQb([grant]));
      productRepo.findOne.mockResolvedValue({
        id: PRODUCT,
        ownerPrincipalId: OWNER,
        name: 'Customer Events',
      });

      const count = await worker.runGrantExpiry();

      expect(count).toBe(1);
      expect(notificationsService.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: ORG,
          category: 'access_grant_expiring',
          recipients: ['consumer-1'],
          dedupKey: 'access_grant_expiring:grant-1',
        }),
      );
      expect(grantRepo.update).toHaveBeenCalledWith(
        { id: 'grant-1' },
        expect.objectContaining({ expiryWarningSentAt: expect.any(Date) }),
      );
    });

    it('does not stamp the grant when enqueue throws', async () => {
      const grant = {
        id: 'grant-1',
        orgId: ORG,
        productId: PRODUCT,
        granteePrincipalId: 'consumer-1',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };
      grantRepo.createQueryBuilder.mockReturnValue(makeQb([grant]));
      productRepo.findOne.mockResolvedValue({ id: PRODUCT, name: 'X' });
      notificationsService.enqueue.mockRejectedValueOnce(new Error('boom'));

      const count = await worker.runGrantExpiry();
      expect(count).toBe(0);
      expect(grantRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('runAll', () => {
    it('runs all three branches without throwing on individual failure', async () => {
      // Make grant-expiry blow up; the SLA branches should still complete.
      grantRepo.createQueryBuilder.mockImplementation(() => {
        throw new Error('grant query exploded');
      });
      requestRepo.createQueryBuilder.mockReturnValue(makeQb([]));
      await expect(worker.runAll()).resolves.not.toThrow();
    });
  });
});
