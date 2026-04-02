import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DataProductEntity } from './entities/data-product.entity.js';
import { PortDeclarationEntity } from './entities/port-declaration.entity.js';
import { ProductVersionEntity } from './entities/product-version.entity.js';
import type {
  DataProduct,
  DataProductList,
  CreateDataProductRequest,
  UpdateDataProductRequest,
  DataProductStatus,
  Port,
  PortList,
  DeclarePortRequest,
  UpdatePortRequest,
  ProductVersion,
  ProductVersionList,
} from '@meshos/types';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(DataProductEntity)
    private readonly productRepo: Repository<DataProductEntity>,
    @InjectRepository(PortDeclarationEntity)
    private readonly portRepo: Repository<PortDeclarationEntity>,
    @InjectRepository(ProductVersionEntity)
    private readonly versionRepo: Repository<ProductVersionEntity>,
  ) {}

  // ---------------------------------------------------------------------------
  // Data Products
  // ---------------------------------------------------------------------------

  async listProducts(
    orgId: string,
    domainId: string,
    limit: number,
    offset: number,
    status?: DataProductStatus,
  ): Promise<DataProductList> {
    const where = status
      ? { orgId, domainId, status }
      : { orgId, domainId };
    const [items, total] = await this.productRepo.findAndCount({
      where,
      relations: ['ports'],
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map(this.toDataProduct),
      meta: { total, limit, offset },
    };
  }

  async createProduct(
    orgId: string,
    domainId: string,
    dto: CreateDataProductRequest,
    createdByPrincipalId: string,
  ): Promise<DataProduct> {
    const existing = await this.productRepo.findOne({ where: { orgId, domainId, slug: dto.slug } });
    if (existing) {
      throw new ConflictException(`Data product with slug '${dto.slug}' already exists in this domain`);
    }
    const product = this.productRepo.create({
      orgId,
      domainId,
      name: dto.name,
      slug: dto.slug,
      description: dto.description ?? null,
      classification: dto.classification,
      ownerPrincipalId: dto.ownerPrincipalId,
      tags: dto.tags ?? [],
      status: 'draft',
      version: '0.1.0',
    });
    const saved = await this.productRepo.save(product);

    // Record initial version snapshot.
    await this.versionRepo.save(
      this.versionRepo.create({
        orgId,
        productId: saved.id,
        version: saved.version,
        changeDescription: 'Initial draft',
        snapshot: this.toDataProduct({ ...saved, ports: [] }),
        createdByPrincipalId,
      }),
    );

    return this.toDataProduct({ ...saved, ports: [] });
  }

  async getProduct(orgId: string, domainId: string, productId: string): Promise<DataProduct> {
    const product = await this.productRepo.findOne({
      where: { id: productId, orgId, domainId },
      relations: ['ports'],
    });
    if (!product) throw new NotFoundException(`Data product ${productId} not found`);
    return this.toDataProduct(product);
  }

  async updateProduct(
    orgId: string,
    domainId: string,
    productId: string,
    dto: UpdateDataProductRequest,
  ): Promise<DataProduct> {
    const product = await this.productRepo.findOne({
      where: { id: productId, orgId, domainId },
      relations: ['ports'],
    });
    if (!product) throw new NotFoundException(`Data product ${productId} not found`);
    if (product.status !== 'draft') {
      throw new ConflictException('Only draft products can be updated directly. Create a new version instead.');
    }
    if (dto.name !== undefined) product.name = dto.name;
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.classification !== undefined) product.classification = dto.classification;
    if (dto.ownerPrincipalId !== undefined) product.ownerPrincipalId = dto.ownerPrincipalId;
    if (dto.tags !== undefined) product.tags = dto.tags;
    const saved = await this.productRepo.save(product);
    return this.toDataProduct(saved);
  }

  async deleteProduct(orgId: string, domainId: string, productId: string): Promise<void> {
    const product = await this.productRepo.findOne({ where: { id: productId, orgId, domainId } });
    if (!product) throw new NotFoundException(`Data product ${productId} not found`);
    if (product.status !== 'draft') {
      throw new ConflictException('Only draft products can be deleted');
    }
    await this.productRepo.remove(product);
  }

  // ---------------------------------------------------------------------------
  // Ports
  // ---------------------------------------------------------------------------

  async listPorts(
    orgId: string,
    productId: string,
    limit: number,
    offset: number,
  ): Promise<PortList> {
    const [items, total] = await this.portRepo.findAndCount({
      where: { orgId, productId },
      order: { createdAt: 'ASC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map(this.toPort),
      meta: { total, limit, offset },
    };
  }

  async declarePort(
    orgId: string,
    productId: string,
    dto: DeclarePortRequest,
  ): Promise<Port> {
    const port = this.portRepo.create({
      orgId,
      productId,
      portType: dto.portType,
      name: dto.name,
      description: dto.description ?? null,
      interfaceType: dto.interfaceType ?? null,
      contractSchema: dto.contractSchema ?? null,
      slaDescription: dto.slaDescription ?? null,
    });
    const saved = await this.portRepo.save(port);
    return this.toPort(saved);
  }

  async getPort(orgId: string, productId: string, portId: string): Promise<Port> {
    const port = await this.portRepo.findOne({ where: { id: portId, orgId, productId } });
    if (!port) throw new NotFoundException(`Port ${portId} not found`);
    return this.toPort(port);
  }

  async updatePort(
    orgId: string,
    productId: string,
    portId: string,
    dto: UpdatePortRequest,
  ): Promise<Port> {
    const port = await this.portRepo.findOne({ where: { id: portId, orgId, productId } });
    if (!port) throw new NotFoundException(`Port ${portId} not found`);
    if (dto.name !== undefined) port.name = dto.name;
    if (dto.description !== undefined) port.description = dto.description;
    if (dto.interfaceType !== undefined) port.interfaceType = dto.interfaceType;
    if (dto.contractSchema !== undefined) port.contractSchema = dto.contractSchema;
    if (dto.slaDescription !== undefined) port.slaDescription = dto.slaDescription;
    const saved = await this.portRepo.save(port);
    return this.toPort(saved);
  }

  async deletePort(orgId: string, productId: string, portId: string): Promise<void> {
    const port = await this.portRepo.findOne({ where: { id: portId, orgId, productId } });
    if (!port) throw new NotFoundException(`Port ${portId} not found`);
    await this.portRepo.remove(port);
  }

  // ---------------------------------------------------------------------------
  // Versions
  // ---------------------------------------------------------------------------

  async listVersions(
    orgId: string,
    productId: string,
    limit: number,
    offset: number,
  ): Promise<ProductVersionList> {
    const [items, total] = await this.versionRepo.findAndCount({
      where: { orgId, productId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return {
      items: items.map(this.toProductVersion),
      meta: { total, limit, offset },
    };
  }

  // ---------------------------------------------------------------------------
  // Mappers
  // ---------------------------------------------------------------------------

  private toDataProduct(entity: DataProductEntity): DataProduct {
    return {
      id: entity.id,
      orgId: entity.orgId,
      domainId: entity.domainId,
      name: entity.name,
      slug: entity.slug,
      description: entity.description,
      status: entity.status,
      version: entity.version,
      classification: entity.classification,
      ownerPrincipalId: entity.ownerPrincipalId,
      tags: entity.tags,
      ports: (entity.ports ?? []).map(this.toPort),
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  private toPort(entity: PortDeclarationEntity): Port {
    return {
      id: entity.id,
      productId: entity.productId,
      orgId: entity.orgId,
      portType: entity.portType,
      name: entity.name,
      description: entity.description,
      interfaceType: entity.interfaceType,
      contractSchema: entity.contractSchema,
      slaDescription: entity.slaDescription,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  private toProductVersion(entity: ProductVersionEntity): ProductVersion {
    return {
      id: entity.id,
      productId: entity.productId,
      orgId: entity.orgId,
      version: entity.version,
      changeDescription: entity.changeDescription,
      snapshot: entity.snapshot,
      createdAt: entity.createdAt.toISOString(),
      createdByPrincipalId: entity.createdByPrincipalId ?? '',
    };
  }
}
