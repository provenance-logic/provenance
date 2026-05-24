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
  situationAEligibility: false,
  catalogName: null,
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

  // ---------------------------------------------------------------------------
  // Phase 5.9 / F10.15 layer 1 — Situation detection
  // ---------------------------------------------------------------------------

  describe('resolveSituationForPort', () => {
    const PRODUCT = { id: 'product-1', orgId: 'org-1', slug: 'revenue-daily', ownerPrincipalId: 'owner-1' };

    function activeGrant() {
      return {
        id: 'grant-1',
        orgId: 'org-1',
        productId: 'product-1',
        granteePrincipalId: 'requester-1',
        grantedAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        revokedAt: null,
      };
    }

    it('returns null when the product does not exist', async () => {
      productRepo.findOne.mockResolvedValue(null);
      const result = await svc.resolveSituationForPort('org-1', 'missing', 'port-1', 'requester-1');
      expect(result).toBeNull();
    });

    it('returns null when the port does not exist', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(null);
      const result = await svc.resolveSituationForPort('org-1', 'product-1', 'missing', 'requester-1');
      expect(result).toBeNull();
    });

    it('Situation A when the producer declared situationAEligibility = true (no grant needed)', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({ situationAEligibility: true }));
      grantRepo.findOne.mockResolvedValue(null); // no grant
      const result = await svc.resolveSituationForPort('org-1', 'product-1', 'port-1', 'requester-1');
      expect(result?.situation).toBe('A');
      expect(result?.recommendedNext).toBe('view_snippet');
      expect(result?.declaredSituationAEligible).toBe(true);
      expect(result?.callerHasActiveGrant).toBe(false);
    });

    it('Situation B + view_snippet when caller has an active grant', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({ situationAEligibility: false }));
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.resolveSituationForPort('org-1', 'product-1', 'port-1', 'requester-1');
      expect(result?.situation).toBe('B');
      expect(result?.recommendedNext).toBe('view_snippet');
      expect(result?.callerHasActiveGrant).toBe(true);
    });

    it('Situation B + request_access when caller has no active grant', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({ situationAEligibility: false }));
      grantRepo.findOne.mockResolvedValue(null);
      const result = await svc.resolveSituationForPort('org-1', 'product-1', 'port-1', 'requester-1');
      expect(result?.situation).toBe('B');
      expect(result?.recommendedNext).toBe('request_access');
      expect(result?.callerHasActiveGrant).toBe(false);
    });

    it('product owner is treated as having a grant regardless of grant table state', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({ situationAEligibility: false }));
      // No grant table entry — owner path short-circuits.
      grantRepo.findOne.mockResolvedValue(null);
      const result = await svc.resolveSituationForPort('org-1', 'product-1', 'port-1', PRODUCT.ownerPrincipalId);
      expect(result?.situation).toBe('B');
      expect(result?.recommendedNext).toBe('view_snippet');
      expect(result?.callerHasActiveGrant).toBe(true);
    });

    it('A overrides grant-check — the caller does not need a grant when the port is open', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({ situationAEligibility: true }));
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.resolveSituationForPort('org-1', 'product-1', 'port-1', 'requester-1');
      expect(result?.situation).toBe('A');
      expect(result?.recommendedNext).toBe('view_snippet');
      // The caller-has-grant flag is still reported truthfully so the UI can
      // surface "you have a grant but this port is open to everyone anyway."
      expect(result?.callerHasActiveGrant).toBe(true);
    });

    it('treats a revoked grant as no grant (Situation B + request_access)', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({ situationAEligibility: false }));
      grantRepo.findOne.mockResolvedValue({ ...activeGrant(), revokedAt: new Date() });
      const result = await svc.resolveSituationForPort('org-1', 'product-1', 'port-1', 'requester-1');
      expect(result?.situation).toBe('B');
      expect(result?.recommendedNext).toBe('request_access');
      expect(result?.callerHasActiveGrant).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // F10.15 → F10.6 interaction: a Situation-A-eligible port bypasses the
  // grant requirement for snippet generation (the producer has declared
  // it open to all source-system principals, so the connection details
  // aren't sensitive in the F10.6 sense — consumer connects with their
  // own credentials anyway).
  // ---------------------------------------------------------------------------

  describe('generateSnippetForPort — Situation A bypasses grant requirement', () => {
    const PRODUCT = { id: 'product-1', orgId: 'org-1', slug: 'revenue-daily', ownerPrincipalId: 'owner-1' };

    it('renders the snippet for a Situation-A port even when the caller has no grant', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({ situationAEligibility: true }));
      grantRepo.findOne.mockResolvedValue(null); // no grant

      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'python', 'requester-1');
      expect(result?.available).toBe(true);
      expect(result?.code).toContain('psycopg2');
    });

    it('still gates a Situation-B port behind a grant (regression check)', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({ situationAEligibility: false }));
      grantRepo.findOne.mockResolvedValue(null);

      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'python', 'requester-1');
      expect(result?.available).toBe(false);
      expect(result?.reason).toBe('request_access_required');
    });
  });

  // ---------------------------------------------------------------------------
  // F10.14 / Phase 5.11 — catalog-name resolution in snippet generation
  // ---------------------------------------------------------------------------

  describe('generateSnippetForPort — catalog-name resolution (F10.14)', () => {
    const PRODUCT = { id: 'product-1', orgId: 'org-1', slug: 'revenue-daily', ownerPrincipalId: 'owner-1' };

    function activeGrant() {
      return {
        id: 'grant-1',
        orgId: 'org-1',
        productId: 'product-1',
        granteePrincipalId: 'owner-1',
        grantedAt: new Date(),
        expiresAt: null,
        revokedAt: null,
      };
    }

    it('uses port.catalogName as the SQL table reference when set', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({ catalogName: 'customer_360' }));
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'python', 'owner-1');
      expect(result?.available).toBe(true);
      expect(result?.code).toContain('SELECT * FROM customer_360 LIMIT 10;');
    });

    it('falls back to sourceObjectPath when catalogName is null', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({
        catalogName: null,
        sourceObjectPath: 'prod.customer.events',
      }));
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'python', 'owner-1');
      expect(result?.available).toBe(true);
      expect(result?.code).toContain('SELECT * FROM prod.customer.events LIMIT 10;');
    });

    it('falls back to a generic placeholder when neither is set', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({ catalogName: null, sourceObjectPath: null }));
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'python', 'owner-1');
      expect(result?.available).toBe(true);
      // makePort's connection_details uses schema 'public' by default
      expect(result?.code).toContain('SELECT * FROM public.<table> LIMIT 10;');
    });

    it('catalogName trumps sourceObjectPath when both are set', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({
        catalogName: 'customer_360',
        sourceObjectPath: 'prod.customer.events',
      }));
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'python', 'owner-1');
      expect(result?.code).toContain('SELECT * FROM customer_360 LIMIT 10;');
      expect(result?.code).not.toContain('prod.customer.events');
    });

    it('dbt snippet emits a commented source() hint when catalogName is set', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({ catalogName: 'customer_360' }));
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'dbt', 'owner-1');
      expect(result?.available).toBe(true);
      expect(result?.code).toContain(`source('provenance_revenue_daily', 'customer_360')`);
    });

    it('dbt snippet has no source() hint when catalogName is null', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({ catalogName: null }));
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'dbt', 'owner-1');
      expect(result?.code).not.toContain('source(');
    });
  });

  // ---------------------------------------------------------------------------
  // Phase 5.14 Part B / F10.17 — Snowflake-specific snippet shapes
  // ---------------------------------------------------------------------------

  describe('generateSnippetForPort — Snowflake destination shapes', () => {
    const PRODUCT = { id: 'product-1', orgId: 'org-1', slug: 'revenue-daily', ownerPrincipalId: 'owner-1' };

    function activeGrant() {
      return { revokedAt: null, expiresAt: null, grantedAt: new Date() };
    }

    function snowflakePort(extras: Record<string, unknown> = {}) {
      return makePort({
        connectionDetails: encryptedEnvelope({
          kind: 'sql_jdbc',
          host: 'xy12345.us-east-1.aws.snowflakecomputing.com',
          port: 443,
          database: 'ANALYTICS',
          schema: 'PUBLIC',
          authMethod: 'username_password',
          sslMode: 'require',
          warehouse: 'COMPUTE_WH',
          role: 'ANALYST',
          ...extras,
        }) as unknown as Record<string, unknown>,
      });
    }

    // --- snowflakeAccount() helper ---

    it('strips .snowflakecomputing.com to derive the account identifier', async () => {
      // Verified indirectly by asserting the python snippet contains the stripped value.
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(snowflakePort());
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'python', 'owner-1');
      // quote() uses JSON.stringify — double-quotes, not single.
      expect(result?.code).toContain(`account="xy12345.us-east-1.aws"`);
      expect(result?.code).not.toContain('snowflakecomputing.com');
    });

    // --- python ---

    it('uses snowflake.connector (not psycopg2) for Snowflake hosts', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(snowflakePort());
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'python', 'owner-1');
      expect(result?.available).toBe(true);
      expect(result?.code).toContain('import snowflake.connector');
      expect(result?.code).not.toContain('psycopg2');
      // quote() uses JSON.stringify — double-quotes, not single.
      expect(result?.code).toContain(`warehouse="COMPUTE_WH"`);
      expect(result?.code).toContain(`role="ANALYST"`);
      expect(result?.code).toContain(`database="ANALYTICS"`);
      expect(result?.code).toContain(`schema="PUBLIC"`);
    });

    it('uses placeholder warehouse/role when fields are absent', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(snowflakePort({ warehouse: undefined, role: undefined }));
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'python', 'owner-1');
      // quote() uses JSON.stringify — double-quotes, not single.
      expect(result?.code).toContain(`warehouse="<your_warehouse>"`);
      expect(result?.code).toContain(`role="<your_role>"`);
    });

    it('non-Snowflake host still produces psycopg2 snippet (regression check)', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort()); // default postgres host
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'python', 'owner-1');
      expect(result?.code).toContain('psycopg2');
      expect(result?.code).not.toContain('snowflake.connector');
    });

    // --- dbt ---

    it('emits type: snowflake with account/warehouse/role (no host/port/sslmode) for Snowflake dbt', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(snowflakePort());
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'dbt', 'owner-1');
      expect(result?.available).toBe(true);
      expect(result?.code).toContain('type: snowflake');
      expect(result?.code).toContain('account: xy12345.us-east-1.aws');
      expect(result?.code).toContain('warehouse: COMPUTE_WH');
      expect(result?.code).toContain('role: ANALYST');
      expect(result?.code).not.toContain('host:');
      expect(result?.code).not.toContain('port:');
      expect(result?.code).not.toContain('sslmode:');
    });

    it('non-Snowflake host still produces host/port/sslmode in dbt snippet (regression check)', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort());
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'dbt', 'owner-1');
      expect(result?.code).toContain('host: db.example.com');
      expect(result?.code).toContain('port: 5432');
      expect(result?.code).toContain('sslmode: require');
      expect(result?.code).not.toContain('account:');
    });

    // --- JDBC URL ---

    it('emits jdbc:snowflake:// with query-string params (no port) for Snowflake JDBC URL', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(snowflakePort());
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'sql_client', 'owner-1');
      expect(result?.available).toBe(true);
      expect(result?.code).toContain('jdbc:snowflake://xy12345.us-east-1.aws.snowflakecomputing.com/');
      expect(result?.code).toContain('warehouse=COMPUTE_WH');
      expect(result?.code).toContain('db=ANALYTICS');
      expect(result?.code).toContain('schema=PUBLIC');
      expect(result?.code).toContain('role=ANALYST');
      // Must NOT look like a regular JDBC URL (no port segment)
      expect(result?.code).not.toContain(':443/');
    });

    it('non-Snowflake host JDBC URL is unchanged (regression check)', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort());
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'sql_client', 'owner-1');
      expect(result?.code).toBe('jdbc:postgresql://db.example.com:5432/orders?sslmode=require');
    });

    // --- Power BI .pbids ---

    it('includes warehouse in the .pbids address for Snowflake', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(snowflakePort());
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'power_bi', 'owner-1');
      expect(result?.available).toBe(true);
      const pbids = JSON.parse(result!.code as string);
      expect(pbids.connections[0].details.protocol).toBe('snowflake');
      expect(pbids.connections[0].details.address.warehouse).toBe('COMPUTE_WH');
      expect(pbids.connections[0].details.address.database).toBe('ANALYTICS');
    });

    it('uses placeholder warehouse in .pbids when field is absent', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(snowflakePort({ warehouse: undefined }));
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'power_bi', 'owner-1');
      const pbids = JSON.parse(result!.code as string);
      expect(pbids.connections[0].details.address.warehouse).toBe('<your_warehouse>');
    });

    it('non-Snowflake .pbids address has no warehouse (regression check)', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort());
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'power_bi', 'owner-1');
      const pbids = JSON.parse(result!.code as string);
      expect(pbids.connections[0].details.address.warehouse).toBeUndefined();
    });

    // --- Tableau .tds ---

    it('includes warehouse and schema in .tds for Snowflake (class=snowflake)', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(snowflakePort());
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'tableau', 'owner-1');
      expect(result?.available).toBe(true);
      const tds = result!.code as string;
      expect(tds).toContain(`class='snowflake'`);
      expect(tds).toContain(`warehouse='COMPUTE_WH'`);
      expect(tds).toContain(`dbname='ANALYTICS'`);
      expect(tds).toContain(`schema='PUBLIC'`);
      // Snowflake Tableau connector uses implicit port — must not emit port attr.
      expect(tds).not.toContain(`port='`);
    });

    it('uses placeholder warehouse in .tds when field is absent', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(snowflakePort({ warehouse: undefined }));
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'tableau', 'owner-1');
      const tds = result!.code as string;
      // xmlEscape converts < and > — the placeholder appears XML-escaped in the .tds attribute.
      expect(tds).toContain(`warehouse='&lt;your_warehouse&gt;'`);
    });

    it('non-Snowflake .tds is unchanged — no warehouse attr (regression check)', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort());
      grantRepo.findOne.mockResolvedValue(activeGrant());
      const result = await svc.generateSnippetForPort('org-1', 'product-1', 'port-1', 'tableau', 'owner-1');
      const tds = result!.code as string;
      expect(tds).toContain(`class='postgres'`);
      expect(tds).not.toContain(`warehouse=`);
      expect(tds).toContain(`port='5432'`);
    });
  });

  // ---------------------------------------------------------------------------
  // F10.14 / Phase 5.11 — source-side view DDL
  // ---------------------------------------------------------------------------

  describe('resolveSourceViewDdl', () => {
    const PRODUCT = { id: 'product-1', orgId: 'org-1', slug: 'revenue-daily', ownerPrincipalId: 'owner-1' };

    it('returns null when the product does not exist', async () => {
      productRepo.findOne.mockResolvedValue(null);
      const result = await svc.resolveSourceViewDdl('org-1', 'missing', 'port-1');
      expect(result).toBeNull();
    });

    it('returns null when the port does not exist', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(null);
      const result = await svc.resolveSourceViewDdl('org-1', 'product-1', 'missing');
      expect(result).toBeNull();
    });

    it('returns unsupported_interface_type for non-sql_jdbc ports', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({
        interfaceType: 'rest_api',
        catalogName: 'whatever',
        sourceObjectPath: 'whatever',
      }));
      const result = await svc.resolveSourceViewDdl('org-1', 'product-1', 'port-1');
      expect(result?.available).toBe(false);
      expect(result?.reason).toBe('unsupported_interface_type');
    });

    it('returns missing_catalog_name when catalogName is null', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({
        catalogName: null,
        sourceObjectPath: 'prod.customer.events',
      }));
      const result = await svc.resolveSourceViewDdl('org-1', 'product-1', 'port-1');
      expect(result?.available).toBe(false);
      expect(result?.reason).toBe('missing_catalog_name');
    });

    it('returns missing_source_object_path when sourceObjectPath is null', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({
        catalogName: 'customer_360',
        sourceObjectPath: null,
      }));
      const result = await svc.resolveSourceViewDdl('org-1', 'product-1', 'port-1');
      expect(result?.available).toBe(false);
      expect(result?.reason).toBe('missing_source_object_path');
    });

    it('emits a CREATE OR REPLACE VIEW DDL when both fields are set', async () => {
      productRepo.findOne.mockResolvedValue(PRODUCT);
      portRepo.findOne.mockResolvedValue(makePort({
        catalogName: 'customer_360',
        sourceObjectPath: 'prod.customer.events',
      }));
      const result = await svc.resolveSourceViewDdl('org-1', 'product-1', 'port-1');
      expect(result?.available).toBe(true);
      expect(result?.ddl).toContain('CREATE OR REPLACE VIEW customer_360 AS');
      expect(result?.ddl).toContain('SELECT * FROM prod.customer.events;');
    });
  });
});
