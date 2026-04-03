import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrgEntity } from './entities/org.entity.js';
import { DomainEntity } from './entities/domain.entity.js';
import type {
  Organization,
  CreateOrganizationRequest,
  UpdateOrganizationRequest,
  OrganizationList,
  Domain,
  CreateDomainRequest,
  UpdateDomainRequest,
  DomainList,
} from '@provenance/types';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(OrgEntity)
    private readonly orgRepo: Repository<OrgEntity>,
    @InjectRepository(DomainEntity)
    private readonly domainRepo: Repository<DomainEntity>,
  ) {}

  // ---------------------------------------------------------------------------
  // Organizations
  // ---------------------------------------------------------------------------

  async listOrganizations(limit: number, offset: number): Promise<OrganizationList> {
    const [items, total] = await this.orgRepo.findAndCount({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map(this.toOrganization),
      meta: { total, limit, offset },
    };
  }

  async createOrganization(dto: CreateOrganizationRequest): Promise<Organization> {
    const existing = await this.orgRepo.findOne({ where: { slug: dto.slug } });
    if (existing) {
      throw new ConflictException(`Organization with slug '${dto.slug}' already exists`);
    }
    const org = this.orgRepo.create({
      name: dto.name,
      slug: dto.slug,
      description: dto.description ?? null,
      contactEmail: dto.contactEmail ?? null,
      status: 'active',
    });
    const saved = await this.orgRepo.save(org);
    return this.toOrganization(saved);
  }

  async getOrganization(orgId: string): Promise<Organization> {
    const org = await this.orgRepo.findOne({ where: { id: orgId } });
    if (!org) throw new NotFoundException(`Organization ${orgId} not found`);
    return this.toOrganization(org);
  }

  async updateOrganization(orgId: string, dto: UpdateOrganizationRequest): Promise<Organization> {
    const org = await this.orgRepo.findOne({ where: { id: orgId } });
    if (!org) throw new NotFoundException(`Organization ${orgId} not found`);
    if (dto.name !== undefined) org.name = dto.name;
    if (dto.description !== undefined) org.description = dto.description;
    if (dto.contactEmail !== undefined) org.contactEmail = dto.contactEmail;
    const saved = await this.orgRepo.save(org);
    return this.toOrganization(saved);
  }

  // ---------------------------------------------------------------------------
  // Domains
  // ---------------------------------------------------------------------------

  async listDomains(orgId: string, limit: number, offset: number): Promise<DomainList> {
    const [items, total] = await this.domainRepo.findAndCount({
      where: { orgId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map(this.toDomain),
      meta: { total, limit, offset },
    };
  }

  async createDomain(orgId: string, dto: CreateDomainRequest): Promise<Domain> {
    await this.getOrganization(orgId);
    const existing = await this.domainRepo.findOne({ where: { orgId, slug: dto.slug } });
    if (existing) {
      throw new ConflictException(`Domain with slug '${dto.slug}' already exists in this organization`);
    }
    const domain = this.domainRepo.create({
      orgId,
      name: dto.name,
      slug: dto.slug,
      description: dto.description ?? null,
      ownerPrincipalId: dto.ownerPrincipalId,
    });
    const saved = await this.domainRepo.save(domain);
    return this.toDomain(saved);
  }

  async getDomain(orgId: string, domainId: string): Promise<Domain> {
    const domain = await this.domainRepo.findOne({ where: { id: domainId, orgId } });
    if (!domain) throw new NotFoundException(`Domain ${domainId} not found`);
    return this.toDomain(domain);
  }

  async updateDomain(orgId: string, domainId: string, dto: UpdateDomainRequest): Promise<Domain> {
    const domain = await this.domainRepo.findOne({ where: { id: domainId, orgId } });
    if (!domain) throw new NotFoundException(`Domain ${domainId} not found`);
    if (dto.name !== undefined) domain.name = dto.name;
    if (dto.description !== undefined) domain.description = dto.description;
    if (dto.ownerPrincipalId !== undefined) domain.ownerPrincipalId = dto.ownerPrincipalId;
    const saved = await this.domainRepo.save(domain);
    return this.toDomain(saved);
  }

  async deleteDomain(orgId: string, domainId: string): Promise<void> {
    const domain = await this.domainRepo.findOne({ where: { id: domainId, orgId } });
    if (!domain) throw new NotFoundException(`Domain ${domainId} not found`);
    await this.domainRepo.remove(domain);
  }

  // ---------------------------------------------------------------------------
  // Mappers
  // ---------------------------------------------------------------------------

  private toOrganization(entity: OrgEntity): Organization {
    return {
      id: entity.id,
      name: entity.name,
      slug: entity.slug,
      description: entity.description,
      status: entity.status,
      contactEmail: entity.contactEmail,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  private toDomain(entity: DomainEntity): Domain {
    return {
      id: entity.id,
      orgId: entity.orgId,
      name: entity.name,
      slug: entity.slug,
      description: entity.description,
      ownerPrincipalId: entity.ownerPrincipalId,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
