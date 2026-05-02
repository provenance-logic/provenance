import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LineageService } from './lineage.service.js';
import { EmissionLogEntity } from './entities/emission-log.entity.js';
import { TrustScoreService } from '../trust-score/trust-score.service.js';

const ORG_ID = 'org-1';

function buildEmitRequest(overrides: Record<string, unknown> = {}) {
  return {
    source_node: {
      node_type: 'DataProduct' as const,
      node_id: 'product-a',
      org_id: ORG_ID,
      display_name: 'Product A',
    },
    target_node: {
      node_type: 'DataProduct' as const,
      node_id: 'product-b',
      org_id: ORG_ID,
      display_name: 'Product B',
    },
    edge_type: 'derives_from',
    ...overrides,
  };
}

describe('LineageService idempotency', () => {
  let service: LineageService;
  let repo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let trustScore: { recompute: jest.Mock };

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((data) => data),
      save: jest.fn().mockImplementation(async (entity) => ({
        id: 'new-emission-id',
        ...entity,
      })),
      update: jest.fn().mockResolvedValue(undefined),
    };
    trustScore = {
      recompute: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        LineageService,
        { provide: getRepositoryToken(EmissionLogEntity), useValue: repo },
        { provide: TrustScoreService, useValue: trustScore },
      ],
    }).compile();

    service = moduleRef.get(LineageService);
  });

  it('inserts a new row when no idempotency key is supplied', async () => {
    repo.findOne.mockResolvedValue(null);

    await service.emitEvent(ORG_ID, buildEmitRequest());

    expect(repo.findOne).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('returns the existing row instead of inserting when the idempotency key matches', async () => {
    const existing = {
      id: 'existing-emission-id',
      orgId: ORG_ID,
      idempotencyKey: 'seed:lineage:a:b:derives_from',
    } as EmissionLogEntity;
    repo.findOne.mockResolvedValue(existing);

    const result = await service.emitEvent(
      ORG_ID,
      buildEmitRequest({ idempotency_key: 'seed:lineage:a:b:derives_from' }),
    );

    expect(repo.findOne).toHaveBeenCalledWith({
      where: { orgId: ORG_ID, idempotencyKey: 'seed:lineage:a:b:derives_from' },
    });
    expect(repo.save).not.toHaveBeenCalled();
    expect(trustScore.recompute).not.toHaveBeenCalled();
    expect(result.id).toBe('existing-emission-id');
  });

  it('inserts when the idempotency key is supplied but no row exists yet', async () => {
    repo.findOne.mockResolvedValue(null);

    await service.emitEvent(
      ORG_ID,
      buildEmitRequest({ idempotency_key: 'seed:lineage:a:b:derives_from' }),
    );

    expect(repo.findOne).toHaveBeenCalledTimes(1);
    expect(repo.save).toHaveBeenCalledTimes(1);
    const savedArg = repo.save.mock.calls[0][0];
    expect(savedArg.idempotencyKey).toBe('seed:lineage:a:b:derives_from');
  });
});
