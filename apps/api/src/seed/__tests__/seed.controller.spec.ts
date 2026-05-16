import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { SeedController } from '../seed.controller.js';
import { SeedGuard } from '../seed.guard.js';
import { KeycloakAdminService } from '../../auth/keycloak-admin.service.js';
import { OrgEntity } from '../../organizations/entities/org.entity.js';
import { DomainEntity } from '../../organizations/entities/domain.entity.js';
import { PrincipalEntity } from '../../organizations/entities/principal.entity.js';
import { RoleAssignmentEntity } from '../../organizations/entities/role-assignment.entity.js';
import { DataProductEntity } from '../../products/entities/data-product.entity.js';
import { PortDeclarationEntity } from '../../products/entities/port-declaration.entity.js';
import { AgentIdentityEntity } from '../../agents/entities/agent-identity.entity.js';
import { AgentTrustClassificationEntity } from '../../agents/entities/agent-trust-classification.entity.js';
import { PolicyVersionEntity } from '../../governance/entities/policy-version.entity.js';
import { EffectivePolicyEntity } from '../../governance/entities/effective-policy.entity.js';
import { SloDeclarationEntity } from '../../observability/entities/slo-declaration.entity.js';
import { SloEvaluationEntity } from '../../observability/entities/slo-evaluation.entity.js';
import { AccessGrantEntity } from '../../access/entities/access-grant.entity.js';
import { AccessRequestEntity } from '../../access/entities/access-request.entity.js';
import { NotificationEntity } from '../../notifications/entities/notification.entity.js';
import { TrustScoreService } from '../../trust-score/trust-score.service.js';
import { LineageService } from '../../lineage/lineage.service.js';
import { SearchIndexingService } from '../../search/search-indexing.service.js';
import { ProductIndexService } from '../../search/product-index.service.js';
import { OpaClient } from '../../governance/opa/opa-client.js';

// Controller-level coverage for the /seed/principals endpoint. The behavior
// under test is the Keycloak attribute write that closes B-048: after the
// principal upsert, the controller must bind all three provenance_* claims
// on the Keycloak user so tokens carry a complete claim set.
//
// The runner's create-user call sets two of three attributes at user-create
// time, but `provenance_principal_id` cannot be set then because the platform
// principal row doesn't exist yet. The server-side write here closes that
// gap and also overrides any stale value (e.g. the runner writes
// `provenance_principal_type: 'human'`; the canonical value is `'human_user'`).

const ORG_ID = 'org-1';
const KC_USER_ID = 'kc-user-1';
const PRINCIPAL_ID = 'principal-new';

describe('SeedController — POST /seed/principals (B-048 Keycloak attribute write)', () => {
  let controller: SeedController;
  let keycloakAdmin: { updateUserAttributes: jest.Mock };
  let transactionFn: jest.Mock;

  beforeEach(async () => {
    keycloakAdmin = {
      updateUserAttributes: jest.fn().mockResolvedValue(undefined),
    };

    // Transaction stub: yields an entity-manager-shaped object whose
    // getRepository returns just enough surface for the principal() path.
    transactionFn = jest.fn(async (cb: (mgr: any) => Promise<any>) => {
      const mgr: any = {
        getRepository: (entity: any) => {
          if (entity === PrincipalEntity) {
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn((dto: any) => dto),
              save: jest.fn(async (entity: any) => ({ id: PRINCIPAL_ID, ...entity })),
            };
          }
          if (entity === RoleAssignmentEntity) {
            return {
              findOne: jest.fn().mockResolvedValue(null),
              create: jest.fn((dto: any) => dto),
              save: jest.fn(async (entity: any) => entity),
            };
          }
          if (entity === DomainEntity) {
            return {
              find: jest.fn().mockResolvedValue([]),
            };
          }
          return { findOne: jest.fn(), save: jest.fn(), find: jest.fn() };
        },
      };
      return cb(mgr);
    });

    const noopRepo = () => ({
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    });
    const noopService = () => ({});

    const moduleRef = await Test.createTestingModule({
      controllers: [SeedController],
      providers: [
        { provide: SeedGuard, useValue: { canActivate: () => true } },
        { provide: KeycloakAdminService, useValue: keycloakAdmin },
        { provide: getDataSourceToken(), useValue: { transaction: transactionFn } },
        { provide: getRepositoryToken(OrgEntity), useValue: noopRepo() },
        { provide: getRepositoryToken(DomainEntity), useValue: noopRepo() },
        { provide: getRepositoryToken(PrincipalEntity), useValue: noopRepo() },
        { provide: getRepositoryToken(DataProductEntity), useValue: noopRepo() },
        { provide: getRepositoryToken(PortDeclarationEntity), useValue: noopRepo() },
        { provide: getRepositoryToken(AgentIdentityEntity), useValue: noopRepo() },
        { provide: getRepositoryToken(PolicyVersionEntity), useValue: noopRepo() },
        { provide: getRepositoryToken(EffectivePolicyEntity), useValue: noopRepo() },
        { provide: getRepositoryToken(SloDeclarationEntity), useValue: noopRepo() },
        { provide: getRepositoryToken(SloEvaluationEntity), useValue: noopRepo() },
        { provide: getRepositoryToken(AccessGrantEntity), useValue: noopRepo() },
        { provide: getRepositoryToken(AccessRequestEntity), useValue: noopRepo() },
        { provide: getRepositoryToken(NotificationEntity), useValue: noopRepo() },
        { provide: TrustScoreService, useValue: noopService() },
        { provide: LineageService, useValue: noopService() },
        { provide: SearchIndexingService, useValue: noopService() },
        { provide: ProductIndexService, useValue: noopService() },
        { provide: OpaClient, useValue: noopService() },
      ],
    }).compile();

    controller = moduleRef.get(SeedController);
  });

  it('binds all three provenance_* attributes on the Keycloak user after the principal upsert', async () => {
    const result = await controller.principal({
      orgId: ORG_ID,
      keycloakUserId: KC_USER_ID,
      email: 'seed.user@example.com',
      firstName: 'Seed',
      lastName: 'User',
      roles: ['org_admin'] as any,
    });

    expect(result).toEqual({ id: PRINCIPAL_ID });
    expect(keycloakAdmin.updateUserAttributes).toHaveBeenCalledTimes(1);
    expect(keycloakAdmin.updateUserAttributes).toHaveBeenCalledWith(KC_USER_ID, {
      provenance_principal_id: PRINCIPAL_ID,
      provenance_org_id: ORG_ID,
      // Canonical value — overrides the runner's stale 'human' attribute,
      // matching invitations.service.ts and the JwtStrategy default.
      provenance_principal_type: 'human_user',
    });
  });

  it('writes the principal id from the DB row (not whatever the runner posted)', async () => {
    // Even if a future runner accidentally posts an existing keycloakUserId
    // expecting a no-op, the Keycloak write must still happen so a previous
    // partial failure (DB row succeeded, Keycloak attribute write failed) is
    // repaired on the next seed run.
    await controller.principal({
      orgId: ORG_ID,
      keycloakUserId: KC_USER_ID,
      email: 'seed.user@example.com',
      firstName: 'Seed',
      lastName: 'User',
      roles: [],
    });

    const [, attrs] = keycloakAdmin.updateUserAttributes.mock.calls[0];
    expect(attrs.provenance_principal_id).toBe(PRINCIPAL_ID);
  });

  it('does not propagate a Keycloak failure as an HTTP 5xx — the principal row is already committed', async () => {
    keycloakAdmin.updateUserAttributes.mockRejectedValueOnce(new Error('keycloak unreachable'));

    // The endpoint must return successfully so the runner moves on. The
    // principal row is already committed; re-seeding will retry the
    // Keycloak write on the next run.
    await expect(
      controller.principal({
        orgId: ORG_ID,
        keycloakUserId: KC_USER_ID,
        email: 'seed.user@example.com',
        firstName: 'Seed',
        lastName: 'User',
        roles: [],
      }),
    ).resolves.toEqual({ id: PRINCIPAL_ID });
  });
});
