import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConnectionPackageService } from '../connection-package.service.js';
import { DataProductEntity } from '../../products/entities/data-product.entity.js';
import { PortDeclarationEntity } from '../../products/entities/port-declaration.entity.js';
import { AccessGrantEntity } from '../entities/access-grant.entity.js';
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
  sourceRegistrationId: null,
  sourceObjectPath: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  product: null as any,
  ...overrides,
});

describe('ConnectionPackageService', () => {
  let svc: ConnectionPackageService;
  let productRepo: ReturnType<typeof mockRepo>;
  let portRepo: ReturnType<typeof mockRepo>;
  let grantRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ConnectionPackageService,
        { provide: getRepositoryToken(DataProductEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(PortDeclarationEntity), useFactory: mockRepo },
        { provide: getRepositoryToken(AccessGrantEntity), useFactory: mockRepo },
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
    grantRepo = module.get(getRepositoryToken(AccessGrantEntity));
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

  // ---------------------------------------------------------------------------
  // Per-port snippet generation (B-069 partial / consumer-grade outbound)
  // ---------------------------------------------------------------------------

  describe('generateSnippetForPort', () => {
    const PRODUCT = { id: 'product-1', orgId: 'org-1', slug: 'revenue-daily', ownerPrincipalId: 'owner-1' };

    function activeGrant() {
      return { revokedAt: null, expiresAt: null, grantedAt: new Date() };
    }

    it('returns null when product is not found', async () => {
      productRepo.findOne.mockResolvedValue(null);
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'python', 'requester-1');
      expect(result).toBeNull();
    });

    it('returns null when port is not found', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(null);
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'python', 'requester-1');
      expect(result).toBeNull();
    });

    it('returns { available: false, reason: request_access_required } when caller has no grant', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort());
      grantRepo.findOne.mockResolvedValue(null);
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'python', 'requester-1');
      expect(result?.available).toBe(false);
      expect(result?.reason).toBe('request_access_required');
      expect(result?.code).toBeNull();
    });

    it('returns the python snippet when caller has an active grant on a sql_jdbc port', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort());
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'python', 'requester-1');
      expect(result?.available).toBe(true);
      expect(result?.language).toBe('python');
      expect(result?.code).toContain('psycopg2');
      expect(result?.code).toContain('db.example.com');
    });

    it('returns a dbt profiles.yml fragment for sql_jdbc when grant is active', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort());
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'dbt', 'requester-1');
      expect(result?.available).toBe(true);
      expect(result?.language).toBe('yaml');
      expect(result?.code).toContain('provenance_revenue_daily:');
      expect(result?.code).toContain('host: db.example.com');
      expect(result?.code).toContain("user: \"{{ env_var('DBT_USER') }}\"");
    });

    it('returns a bare JDBC URL for the sql_client destination', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort());
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'sql_client', 'requester-1');
      expect(result?.available).toBe(true);
      expect(result?.code).toBe('jdbc:postgresql://db.example.com:5432/orders?sslmode=require');
    });

    it('Phase 5.10: returns a .pbids JSON for power_bi on a sql_jdbc port (postgres default)', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort());
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'power_bi', 'requester-1');
      expect(result?.available).toBe(true);
      expect(result?.language).toBe('json');
      expect(result?.code).toBeTruthy();
      const pbids = JSON.parse(result!.code as string);
      expect(pbids.version).toBe('0.1');
      expect(pbids.connections[0].details.protocol).toBe('postgresql');
      expect(pbids.connections[0].details.address.server).toBe('db.example.com');
      expect(pbids.connections[0].details.address.database).toBe('orders');
      expect(pbids.connections[0].mode).toBe('Import');
    });

    it('Phase 5.10: detects snowflake protocol from the host suffix', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({
        connectionDetails: encryptedEnvelope({
          kind: 'sql_jdbc',
          host: 'xy12345.snowflakecomputing.com',
          port: 443,
          database: 'ANALYTICS',
          schema: 'PUBLIC',
          authMethod: 'username_password',
          sslMode: 'require',
        }) as unknown as Record<string, unknown>,
      }));
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'power_bi', 'requester-1');
      expect(result?.available).toBe(true);
      const pbids = JSON.parse(result!.code as string);
      expect(pbids.connections[0].details.protocol).toBe('snowflake');
    });

    it('Phase 5.10: detects databricks-sql protocol from the host', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({
        connectionDetails: encryptedEnvelope({
          kind: 'sql_jdbc',
          host: 'dbc-12345.cloud.databricks.com',
          port: 443,
          database: 'main',
          schema: 'default',
          authMethod: 'username_password',
          sslMode: 'require',
        }) as unknown as Record<string, unknown>,
      }));
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'power_bi', 'requester-1');
      expect(result?.available).toBe(true);
      const pbids = JSON.parse(result!.code as string);
      expect(pbids.connections[0].details.protocol).toBe('databricks-sql');
    });

    it('Phase 5.10: returns destination_not_yet_supported for power_bi on non-sql_jdbc ports', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({
        interfaceType: 'rest_api',
        connectionDetails: encryptedEnvelope({
          kind: 'rest_api',
          baseUrl: 'https://api.example.com',
          authMethod: 'bearer_token',
          bearerToken: 'tok',
        }) as unknown as Record<string, unknown>,
      }));
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'power_bi', 'requester-1');
      expect(result?.available).toBe(false);
      expect(result?.reason).toBe('destination_not_yet_supported');
    });

    it('Phase 5.10: returns a .tds XML for tableau on a sql_jdbc port (postgres default)', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort());
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'tableau', 'requester-1');
      expect(result?.available).toBe(true);
      expect(result?.language).toBe('xml');
      expect(result?.code).toBeTruthy();
      const tds = result!.code as string;
      expect(tds).toContain(`<?xml version='1.0' encoding='utf-8'?>`);
      expect(tds).toContain(`class='postgres'`);
      expect(tds).toContain(`server='db.example.com'`);
      expect(tds).toContain(`dbname='orders'`);
      expect(tds).toContain(`port='5432'`);
      expect(tds).toContain(`authentication='username-password'`);
    });

    it('Phase 5.10: detects snowflake class from the host suffix and omits port', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({
        connectionDetails: encryptedEnvelope({
          kind: 'sql_jdbc',
          host: 'xy12345.snowflakecomputing.com',
          port: 443,
          database: 'ANALYTICS',
          schema: 'PUBLIC',
          authMethod: 'username_password',
          sslMode: 'require',
        }) as unknown as Record<string, unknown>,
      }));
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'tableau', 'requester-1');
      expect(result?.available).toBe(true);
      const tds = result!.code as string;
      expect(tds).toContain(`class='snowflake'`);
      // Snowflake on 443 uses an implicit port — Tableau infers from class.
      expect(tds).not.toContain(`port='443'`);
    });

    it('Phase 5.10: detects databricks_aws class from the host', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({
        connectionDetails: encryptedEnvelope({
          kind: 'sql_jdbc',
          host: 'dbc-12345.cloud.databricks.com',
          port: 443,
          database: 'main',
          schema: 'default',
          authMethod: 'username_password',
          sslMode: 'require',
        }) as unknown as Record<string, unknown>,
      }));
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'tableau', 'requester-1');
      expect(result?.available).toBe(true);
      const tds = result!.code as string;
      expect(tds).toContain(`class='databricks_aws'`);
    });

    it('Phase 5.10: XML-escapes special characters in product slug and connection fields', async () => {
      productRepo.findOne.mockResolvedValue({ ...PRODUCT, slug: 'orders<&"test' });
      portRepo.findOne.mockResolvedValue(makePort({
        connectionDetails: encryptedEnvelope({
          kind: 'sql_jdbc',
          host: 'db.example.com',
          port: 5432,
          database: `orders&main`,
          schema: 'public',
          authMethod: 'username_password',
          sslMode: 'require',
        }) as unknown as Record<string, unknown>,
      }));
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'tableau', 'requester-1');
      const tds = result!.code as string;
      expect(tds).toContain(`formatted-name='orders&lt;&amp;&quot;test'`);
      expect(tds).toContain(`dbname='orders&amp;main'`);
    });

    it('Phase 5.10: returns destination_not_yet_supported for tableau on non-sql_jdbc ports', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({
        interfaceType: 'rest_api',
        connectionDetails: encryptedEnvelope({
          kind: 'rest_api',
          baseUrl: 'https://api.example.com',
          authMethod: 'bearer_token',
          bearerToken: 'tok',
        }) as unknown as Record<string, unknown>,
      }));
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'tableau', 'requester-1');
      expect(result?.available).toBe(false);
      expect(result?.reason).toBe('destination_not_yet_supported');
    });

    it('returns destination_not_yet_supported when dbt is requested for a rest_api port', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({
        interfaceType: 'rest_api',
        connectionDetails: encryptedEnvelope({
          kind: 'rest_api',
          baseUrl: 'https://api.example.com',
          authMethod: 'bearer_token',
          bearerToken: 'tok',
        }) as unknown as Record<string, unknown>,
      }));
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'dbt', 'requester-1');
      expect(result?.available).toBe(false);
      expect(result?.reason).toBe('destination_not_yet_supported');
    });

    it('treats the product owner as if they have a grant (no grant lookup required)', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort());
      // No grant in repo; owner ID matches requester.
      grantRepo.findOne.mockResolvedValue(null);
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'python', 'owner-1');
      expect(result?.available).toBe(true);
      expect(result?.code).toContain('psycopg2');
    });

    it('treats a revoked grant as no grant', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort());
      grantRepo.findOne.mockResolvedValue({ ...activeGrant(), revokedAt: new Date() });
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'python', 'requester-1');
      expect(result?.available).toBe(false);
      expect(result?.reason).toBe('request_access_required');
    });

    it('treats an expired grant as no grant', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort());
      const expired = new Date(Date.now() - 24 * 60 * 60 * 1000);
      grantRepo.findOne.mockResolvedValue({ ...activeGrant(), expiresAt: expired });
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'python', 'requester-1');
      expect(result?.available).toBe(false);
      expect(result?.reason).toBe('request_access_required');
    });
  });
});
