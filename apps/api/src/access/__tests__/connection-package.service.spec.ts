import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConnectionPackageService } from '../connection-package.service.js';
import { DataProductEntity } from '../../products/entities/data-product.entity.js';
import { PortDeclarationEntity } from '../../products/entities/port-declaration.entity.js';
import { EncryptionService } from '../../common/encryption.service.js';

const mockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
});

const encryptedEnvelope = (payload: Record<string, unknown>) => ({
  version: 1,
  iv: 'iv',
  authTag: 'tag',
  ciphertext: Buffer.from(JSON.stringify(payload)).toString('base64'),
});

const makePort = (
  overrides: Partial<PortDeclarationEntity> = {},
): PortDeclarationEntity => ({
  id: 'port-1',
  orgId: 'org-1',
  productId: 'product-1',
  portType: 'output',
  name: 'Orders Output',
  description: null,
  interfaceType: 'sql_jdbc',
  contractSchema: {
    properties: {
      customer_id: { type: 'string', description: 'Customer identifier' },
      total_cents: { type: 'integer' },
    },
  },
  slaDescription: null,
  connectionDetails: encryptedEnvelope({
    kind: 'sql_jdbc',
    host: 'db.example.com',
    port: 5432,
    database: 'orders',
    schema: 'public',
    authMethod: 'username_password',
    sslMode: 'require',
    username: 'reader',
    password: 'hunter2',
  }) as unknown as Record<string, unknown>,
  connectionDetailsEncrypted: true,
  connectionDetailsValidated: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  product: null as any,
  ...overrides,
});

describe('ConnectionPackageService', () => {
  let svc: ConnectionPackageService;
  let productRepo: ReturnType<typeof mockRepo>;
  let portRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ConnectionPackageService,
        { provide: getRepositoryToken(DataProductEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(PortDeclarationEntity), useFactory: mockRepo },
        {
          provide: EncryptionService,
          useValue: {
            decrypt: jest.fn().mockImplementation((env: { ciphertext: string }) =>
              Promise.resolve(JSON.parse(Buffer.from(env.ciphertext, 'base64').toString('utf8'))),
            ),
            encrypt: jest.fn(),
          },
        },
      ],
    }).compile();

    svc = module.get(ConnectionPackageService);
    productRepo = module.get(getRepositoryToken(DataProductEntity));
    portRepo = module.get(getRepositoryToken(PortDeclarationEntity));
  });

  it('returns null when the product has no output ports', async () => {
    productRepo.findOne.mockResolvedValue({ id: 'product-1', orgId: 'org-1' });
    portRepo.find.mockResolvedValue([]);
    const pkg = await svc.generateForProduct('org-1', 'product-1');
    expect(pkg).toBeNull();
  });

  it('generates a SQL/JDBC package with JDBC URL, Python snippet, sample query and data dictionary', async () => {
    productRepo.findOne.mockResolvedValue({ id: 'product-1', orgId: 'org-1' });
    portRepo.find.mockResolvedValue([makePort()]);
    const pkg = await svc.generateForProduct('org-1', 'product-1');
    expect(pkg).not.toBeNull();
    expect(pkg!.packageVersion).toBe(1);
    expect(pkg!.ports).toHaveLength(1);
    const port = pkg!.ports[0];
    expect(port.interfaceType).toBe('sql_jdbc');
    expect(port.artifacts.jdbcUrl).toContain('jdbc:postgresql://db.example.com:5432/orders');
    expect(port.artifacts.pythonSnippet).toEqual(expect.stringContaining('psycopg2'));
    expect(port.artifacts.sampleQuery).toEqual(expect.stringContaining('customer_id'));
    expect(port.artifacts.dataDictionary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'customer_id', type: 'string' }),
      ]),
    );
  });

  it('generates a REST API package with curl, Postman collection, Python snippet', async () => {
    productRepo.findOne.mockResolvedValue({ id: 'product-1', orgId: 'org-1' });
    portRepo.find.mockResolvedValue([
      makePort({
        interfaceType: 'rest_api',
        connectionDetails: encryptedEnvelope({
          kind: 'rest_api',
          baseUrl: 'https://api.example.com/v1',
          authMethod: 'bearer_token',
          bearerToken: 'xyz',
        }) as unknown as Record<string, unknown>,
      }),
    ]);
    const pkg = await svc.generateForProduct('org-1', 'product-1');
    const port = pkg!.ports[0];
    expect(port.interfaceType).toBe('rest_api');
    expect(port.artifacts.curlExample).toContain('curl');
    expect(port.artifacts.curlExample).toContain('Authorization: Bearer');
    expect(port.artifacts.postmanCollection).toEqual(
      expect.objectContaining({ info: expect.any(Object), item: expect.any(Array) }),
    );
    expect(port.artifacts.pythonSnippet).toEqual(expect.stringContaining('requests.get'));
  });

  it('generates a GraphQL package with example query and Python gql snippet', async () => {
    productRepo.findOne.mockResolvedValue({ id: 'product-1', orgId: 'org-1' });
    portRepo.find.mockResolvedValue([
      makePort({
        interfaceType: 'graphql',
        connectionDetails: encryptedEnvelope({
          kind: 'graphql',
          endpointUrl: 'https://graphql.example.com',
          authMethod: 'none',
        }) as unknown as Record<string, unknown>,
      }),
    ]);
    const pkg = await svc.generateForProduct('org-1', 'product-1');
    const port = pkg!.ports[0];
    expect(port.artifacts.exampleQuery).toEqual(expect.stringContaining('query'));
    expect(port.artifacts.pythonSnippet).toEqual(expect.stringContaining('gql'));
  });

  it('generates a Kafka package with consumer config and Python snippet', async () => {
    productRepo.findOne.mockResolvedValue({ id: 'product-1', orgId: 'org-1' });
    portRepo.find.mockResolvedValue([
      makePort({
        interfaceType: 'streaming_topic',
        connectionDetails: encryptedEnvelope({
          kind: 'streaming_topic',
          bootstrapServers: 'kafka:9092',
          topic: 'orders.v1',
          authMethod: 'sasl_plain',
        }) as unknown as Record<string, unknown>,
      }),
    ]);
    const pkg = await svc.generateForProduct('org-1', 'product-1');
    const port = pkg!.ports[0];
    expect(port.artifacts.consumerConfig).toEqual(expect.stringContaining('bootstrap.servers=kafka:9092'));
    expect(port.artifacts.pythonSnippet).toEqual(expect.stringContaining('KafkaConsumer'));
  });

  it('generates a File export package with CLI command and boto3 snippet for S3', async () => {
    productRepo.findOne.mockResolvedValue({ id: 'product-1', orgId: 'org-1' });
    portRepo.find.mockResolvedValue([
      makePort({
        interfaceType: 'file_object_export',
        connectionDetails: encryptedEnvelope({
          kind: 'file_object_export',
          storage: 's3',
          bucket: 'orders-exports',
          pathPrefix: 'daily/',
          authMethod: 'iam',
          fileFormat: 'parquet',
        }) as unknown as Record<string, unknown>,
      }),
    ]);
    const pkg = await svc.generateForProduct('org-1', 'product-1');
    const port = pkg!.ports[0];
    expect(port.artifacts.cliCommand).toEqual(expect.stringContaining('aws s3'));
    expect(port.artifacts.pythonSnippet).toEqual(expect.stringContaining('boto3'));
  });

  it('attaches an agent integration guide when any port is a semantic query endpoint', async () => {
    productRepo.findOne.mockResolvedValue({ id: 'product-1', orgId: 'org-1', name: 'Orders' });
    portRepo.find.mockResolvedValue([
      makePort({
        interfaceType: 'semantic_query_endpoint',
        connectionDetails: null,
        connectionDetailsEncrypted: false,
      }),
    ]);
    const pkg = await svc.generateForProduct('org-1', 'product-1');
    expect(pkg!.agentIntegration).toBeDefined();
    expect(pkg!.agentIntegration!.mcpToolCalls).toEqual(
      expect.arrayContaining([expect.stringContaining('semantic_search')]),
    );
  });

  it('skips a port whose encrypted details cannot be decrypted rather than failing the whole package', async () => {
    productRepo.findOne.mockResolvedValue({ id: 'product-1', orgId: 'org-1' });
    const p = makePort();
    portRepo.find.mockResolvedValue([p, makePort({ id: 'port-2', name: 'Other' })]);
    const module = (svc as unknown as { encryptionService: { decrypt: jest.Mock } });
    module.encryptionService.decrypt
      .mockResolvedValueOnce({
        kind: 'sql_jdbc',
        host: 'h',
        port: 5432,
        database: 'd',
        schema: 's',
        authMethod: 'iam',
        sslMode: 'require',
      })
      .mockRejectedValueOnce(new Error('bad tag'));

    const pkg = await svc.generateForProduct('org-1', 'product-1');
    expect(pkg!.ports).toHaveLength(1);
    expect(pkg!.ports[0].portId).toBe('port-1');
  });
});
