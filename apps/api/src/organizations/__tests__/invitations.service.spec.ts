import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InvitationsService } from '../invitations.service.js';
import { OrgEntity } from '../entities/org.entity.js';
import { DomainEntity } from '../entities/domain.entity.js';
import { InvitationEntity } from '../entities/invitation.entity.js';
import { GovernanceConfigEntity } from '../entities/governance-config.entity.js';
import { PrincipalEntity } from '../entities/principal.entity.js';
import { RoleAssignmentEntity } from '../entities/role-assignment.entity.js';
import { EmailService } from '../../email/email.service.js';
import { KeycloakAdminService } from '../../auth/keycloak-admin.service.js';

const mockOrgRepo = () => ({ findOne: jest.fn() });
const mockDomainRepo = () => ({ findOne: jest.fn() });
const mockInvitationRepo = () => ({
  findAndCount: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((dto: Partial<InvitationEntity>) => dto),
  save: jest.fn((entity: Partial<InvitationEntity>) => ({
    id: entity.id ?? 'inv-001',
    createdAt: entity.createdAt ?? new Date(),
    resendCount: 0,
    consumedAt: null,
    ...entity,
  })),
});
const mockGovernanceConfigRepo = () => ({ findOne: jest.fn() });
const mockPrincipalRepo = () => ({ findOne: jest.fn() });
const mockRoleAssignmentRepo = () => ({ findOne: jest.fn(), save: jest.fn() });

const mockDataSource = () => ({
  transaction: jest.fn(async (cb: (mgr: any) => Promise<any>) => {
    const txState: any = { invitation: null };
    const mgr: any = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: (entity: any) => {
        if (entity === PrincipalEntity) {
          return {
            findOne: jest.fn().mockResolvedValue(null),
            create: jest.fn((dto: any) => dto),
            save: jest.fn((entity: any) => ({ id: 'principal-new', ...entity })),
          };
        }
        if (entity === RoleAssignmentEntity) {
          return {
            findOne: jest.fn().mockResolvedValue(null),
            create: jest.fn((dto: any) => dto),
            save: jest.fn((entity: any) => entity),
          };
        }
        if (entity === InvitationEntity) {
          return {
            findOne: jest.fn().mockResolvedValue(txState.invitation),
            save: jest.fn((entity: any) => entity),
          };
        }
        return { findOne: jest.fn(), save: jest.fn() };
      },
      __setInvitation: (inv: any) => { txState.invitation = inv; },
    };
    return cb(mgr);
  }),
});

const mockEmailService = () => ({
  send: jest.fn().mockResolvedValue({ messageId: 'msg-1', accepted: true }),
});

const mockKeycloakAdmin = () => ({
  findUserByEmail: jest.fn(),
  createUser: jest.fn(),
  updateUserAttributes: jest.fn().mockResolvedValue(undefined),
  assignRealmRoles: jest.fn().mockResolvedValue(undefined),
  executeActionsEmail: jest.fn().mockResolvedValue(undefined),
});

describe('InvitationsService', () => {
  let service: InvitationsService;
  let orgRepo: ReturnType<typeof mockOrgRepo>;
  let invitationRepo: ReturnType<typeof mockInvitationRepo>;
  let governanceConfigRepo: ReturnType<typeof mockGovernanceConfigRepo>;
  let principalRepo: ReturnType<typeof mockPrincipalRepo>;
  let emailService: ReturnType<typeof mockEmailService>;
  let keycloakAdmin: ReturnType<typeof mockKeycloakAdmin>;
  let dataSource: any;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: getRepositoryToken(OrgEntity), useFactory: mockOrgRepo },
        { provide: getRepositoryToken(DomainEntity), useFactory: mockDomainRepo },
        { provide: getRepositoryToken(InvitationEntity), useFactory: mockInvitationRepo },
        { provide: getRepositoryToken(GovernanceConfigEntity), useFactory: mockGovernanceConfigRepo },
        { provide: getRepositoryToken(PrincipalEntity), useFactory: mockPrincipalRepo },
        { provide: getRepositoryToken(RoleAssignmentEntity), useFactory: mockRoleAssignmentRepo },
        { provide: getDataSourceToken(), useFactory: mockDataSource },
        { provide: EmailService, useFactory: mockEmailService },
        { provide: KeycloakAdminService, useFactory: mockKeycloakAdmin },
      ],
    }).compile();

    service = module.get(InvitationsService);
    orgRepo = module.get(getRepositoryToken(OrgEntity));
    invitationRepo = module.get(getRepositoryToken(InvitationEntity));
    governanceConfigRepo = module.get(getRepositoryToken(GovernanceConfigEntity));
    principalRepo = module.get(getRepositoryToken(PrincipalEntity));
    emailService = module.get(EmailService);
    keycloakAdmin = module.get(KeycloakAdminService);
    dataSource = module.get(getDataSourceToken());
  });

  // ---------------------------------------------------------------------------
  // createInvitation
  // ---------------------------------------------------------------------------

  describe('createInvitation', () => {
    it('throws NotFoundException when org does not exist', async () => {
      orgRepo.findOne.mockResolvedValue(null);
      await expect(
        service.createInvitation('org-x', { email: 'a@b.co', role: 'consumer' }, 'p-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for invalid email', async () => {
      orgRepo.findOne.mockResolvedValue({ id: 'org-1', name: 'Acme' });
      await expect(
        service.createInvitation('org-1', { email: 'not-an-email', role: 'consumer' }, 'p-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when an active invitation already exists', async () => {
      orgRepo.findOne.mockResolvedValue({ id: 'org-1', name: 'Acme' });
      invitationRepo.findOne.mockResolvedValue({ id: 'inv-existing' });
      await expect(
        service.createInvitation('org-1', { email: 'a@b.co', role: 'consumer' }, 'p-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('creates invitation with default TTL and sends email', async () => {
      orgRepo.findOne.mockResolvedValue({ id: 'org-1', name: 'Acme' });
      invitationRepo.findOne.mockResolvedValue(null);
      governanceConfigRepo.findOne.mockResolvedValue(null);
      principalRepo.findOne.mockResolvedValue({ displayName: 'Alice', email: 'alice@acme.co' });

      const result = await service.createInvitation(
        'org-1',
        { email: 'bob@example.com', role: 'consumer' },
        'principal-alice',
      );

      expect(invitationRepo.save).toHaveBeenCalled();
      const saved = invitationRepo.save.mock.calls[0][0] as InvitationEntity;
      expect(saved.email).toBe('bob@example.com');
      expect(saved.role).toBe('consumer');
      expect(saved.invitedByPrincipalId).toBe('principal-alice');
      expect(saved.token).toBeTruthy();
      expect(saved.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(emailService.send).toHaveBeenCalled();
      expect(result.status).toBe('pending');
    });

    it('honors governance_configs TTL override when present', async () => {
      orgRepo.findOne.mockResolvedValue({ id: 'org-1', name: 'Acme' });
      invitationRepo.findOne.mockResolvedValue(null);
      governanceConfigRepo.findOne.mockResolvedValue({ valueJson: 72 });
      principalRepo.findOne.mockResolvedValue({ displayName: 'Alice' });

      await service.createInvitation('org-1', { email: 'a@b.co', role: 'consumer' }, 'p-1');

      const saved = invitationRepo.save.mock.calls[0][0] as InvitationEntity;
      const delta = saved.expiresAt.getTime() - Date.now();
      expect(delta).toBeGreaterThan(71 * 60 * 60 * 1000);
      expect(delta).toBeLessThan(73 * 60 * 60 * 1000);
    });

    it('normalizes email to lowercase before checking for duplicates and storing', async () => {
      orgRepo.findOne.mockResolvedValue({ id: 'org-1', name: 'Acme' });
      invitationRepo.findOne.mockResolvedValue(null);
      governanceConfigRepo.findOne.mockResolvedValue(null);
      principalRepo.findOne.mockResolvedValue(null);

      await service.createInvitation('org-1', { email: 'Bob@Example.COM', role: 'consumer' }, 'p-1');

      const saved = invitationRepo.save.mock.calls[0][0] as InvitationEntity;
      expect(saved.email).toBe('bob@example.com');
    });
  });

  // ---------------------------------------------------------------------------
  // resendInvitation
  // ---------------------------------------------------------------------------

  describe('resendInvitation', () => {
    it('throws NotFoundException when invitation does not exist', async () => {
      invitationRepo.findOne.mockResolvedValue(null);
      await expect(service.resendInvitation('org-1', 'inv-x')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when already consumed', async () => {
      invitationRepo.findOne.mockResolvedValue({
        id: 'inv-1',
        orgId: 'org-1',
        consumedAt: new Date(),
      });
      await expect(service.resendInvitation('org-1', 'inv-1')).rejects.toThrow(BadRequestException);
    });

    it('extends expires_at, increments resend_count, and re-sends email', async () => {
      const past = new Date(Date.now() - 1000 * 60 * 60);
      invitationRepo.findOne.mockResolvedValue({
        id: 'inv-1',
        orgId: 'org-1',
        email: 'bob@example.com',
        role: 'consumer',
        domainId: null,
        token: 'abc',
        expiresAt: past,
        consumedAt: null,
        resendCount: 0,
        invitedByPrincipalId: 'p-1',
        createdAt: new Date(),
      });
      orgRepo.findOne.mockResolvedValue({ id: 'org-1', name: 'Acme' });
      governanceConfigRepo.findOne.mockResolvedValue(null);
      principalRepo.findOne.mockResolvedValue({ displayName: 'Alice' });

      await service.resendInvitation('org-1', 'inv-1');

      const saved = invitationRepo.save.mock.calls[0][0] as InvitationEntity;
      expect(saved.resendCount).toBe(1);
      expect(saved.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(emailService.send).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // acceptInvitation
  // ---------------------------------------------------------------------------

  describe('acceptInvitation', () => {
    function mockTxWithInvitation(inv: any) {
      dataSource.transaction.mockImplementation(async (cb: (mgr: any) => Promise<any>) => {
        const mgr: any = {
          query: jest.fn().mockResolvedValue([]),
          getRepository: (entity: any) => {
            if (entity === PrincipalEntity) {
              return {
                findOne: jest.fn().mockResolvedValue(null),
                create: jest.fn((dto: any) => dto),
                save: jest.fn((e: any) => ({ id: 'principal-new', ...e })),
              };
            }
            if (entity === RoleAssignmentEntity) {
              return {
                findOne: jest.fn().mockResolvedValue(null),
                create: jest.fn((dto: any) => dto),
                save: jest.fn((e: any) => e),
              };
            }
            if (entity === InvitationEntity) {
              return {
                findOne: jest.fn().mockResolvedValue(inv),
                save: jest.fn((e: any) => e),
              };
            }
            return { findOne: jest.fn(), save: jest.fn() };
          },
        };
        return cb(mgr);
      });
    }

    it('throws NotFoundException when no invitation with the token exists', async () => {
      mockTxWithInvitation(null);
      await expect(service.acceptInvitation('nonexistent', {})).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when invitation has been consumed', async () => {
      mockTxWithInvitation({
        id: 'inv-1',
        token: 'abc',
        email: 'x@y.z',
        orgId: 'org-1',
        role: 'consumer',
        domainId: null,
        expiresAt: new Date(Date.now() + 3600_000),
        consumedAt: new Date(),
        invitedByPrincipalId: 'p-1',
        resendCount: 0,
        createdAt: new Date(),
      });
      await expect(service.acceptInvitation('abc', {})).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when invitation has expired', async () => {
      mockTxWithInvitation({
        id: 'inv-1',
        token: 'abc',
        email: 'x@y.z',
        orgId: 'org-1',
        role: 'consumer',
        domainId: null,
        expiresAt: new Date(Date.now() - 1000),
        consumedAt: null,
        invitedByPrincipalId: 'p-1',
        resendCount: 0,
        createdAt: new Date(),
      });
      await expect(service.acceptInvitation('abc', {})).rejects.toThrow(ForbiddenException);
    });

    it('creates a Keycloak user when none exists for the invited email', async () => {
      mockTxWithInvitation({
        id: 'inv-1',
        token: 'abc',
        email: 'bob@example.com',
        orgId: 'org-1',
        role: 'consumer',
        domainId: null,
        expiresAt: new Date(Date.now() + 3600_000),
        consumedAt: null,
        invitedByPrincipalId: 'p-1',
        resendCount: 0,
        createdAt: new Date(),
      });
      keycloakAdmin.findUserByEmail.mockResolvedValue(null);
      keycloakAdmin.createUser.mockResolvedValue('kc-user-123');

      const result = await service.acceptInvitation('abc', { firstName: 'Bob', lastName: 'Jones' });

      expect(keycloakAdmin.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'bob@example.com',
          emailVerified: true,
          requiredActions: ['UPDATE_PASSWORD'],
        }),
      );
      expect(keycloakAdmin.updateUserAttributes).toHaveBeenCalledWith('kc-user-123', expect.objectContaining({
        provenance_org_id: 'org-1',
        provenance_principal_type: 'human_user',
      }));
      expect(keycloakAdmin.assignRealmRoles).toHaveBeenCalledWith('kc-user-123', ['consumer']);
      expect(result.orgId).toBe('org-1');
      expect(result.role).toBe('consumer');
    });

    it('reuses existing Keycloak user when one already exists', async () => {
      mockTxWithInvitation({
        id: 'inv-1',
        token: 'abc',
        email: 'existing@example.com',
        orgId: 'org-1',
        role: 'consumer',
        domainId: null,
        expiresAt: new Date(Date.now() + 3600_000),
        consumedAt: null,
        invitedByPrincipalId: 'p-1',
        resendCount: 0,
        createdAt: new Date(),
      });
      keycloakAdmin.findUserByEmail.mockResolvedValue({
        id: 'kc-existing',
        email: 'existing@example.com',
        emailVerified: true,
      });

      await service.acceptInvitation('abc', {});

      expect(keycloakAdmin.createUser).not.toHaveBeenCalled();
      expect(keycloakAdmin.updateUserAttributes).toHaveBeenCalledWith('kc-existing', expect.any(Object));
    });
  });
});
