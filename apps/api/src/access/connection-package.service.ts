import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DataProductEntity } from '../products/entities/data-product.entity.js';
import { PortDeclarationEntity } from '../products/entities/port-declaration.entity.js';
import { AccessGrantEntity } from './entities/access-grant.entity.js';
import { EncryptionService, type EncryptedEnvelope } from '../common/encryption.service.js';
import type {
  ConnectionDetails,
  ConnectionPackage,
  ConnectionPackagePort,
  OutputPortInterfaceType,
  PortSituationResponse,
  SqlJdbcConnectionDetails,
  RestApiConnectionDetails,
  GraphQlConnectionDetails,
  KafkaConnectionDetails,
  FileExportConnectionDetails,
} from '@provenance/types';

// ---------------------------------------------------------------------------
// Per-port snippet generation (consumer-grade outbound, B-069 partial close)
//
// The user story (see consumer-grade-outbound-reframe-2026-05-22.md) wants
// the consumer to pick their tool from a list and receive a ready-to-use
// configuration snippet. Tonight ships:
//   - `python`: all 6 interface types (reuses existing per-type generators)
//   - `dbt`: sql_jdbc only (new generator below)
//   - other destinations return { available: false, reason: 'destination_not_yet_supported' }
//
// Snippet visibility mirrors the connection_details disclosure rule
// (F10.6): user must own the product OR have an active access grant on it.
// Without one, the response is { available: false, reason: 'request_access_required' }.
// ---------------------------------------------------------------------------

export type SnippetDestination =
  | 'python'
  | 'dbt'
  | 'sql_client'
  | 'jdbc'
  | 'power_bi'
  | 'tableau';

export const SUPPORTED_SNIPPET_DESTINATIONS: SnippetDestination[] = [
  'python',
  'dbt',
  'sql_client',
  'jdbc',
  'power_bi',
  'tableau',
];

export type SnippetLanguage = 'python' | 'yaml' | 'text' | 'json' | 'xml';

export interface PortSnippetResponse {
  destination: SnippetDestination;
  language: SnippetLanguage;
  code: string | null;
  available: boolean;
  /** Human-readable reason when `available === false`. */
  reason?:
    | 'request_access_required'
    | 'destination_not_yet_supported'
    | 'port_has_no_connection_details'
    | 'unsupported_interface_type';
}

interface PortArtifacts {
  interfaceType: OutputPortInterfaceType;
  artifacts: Record<string, unknown>;
  agentAccessible: boolean;
}

/**
 * Generates a per-product ConnectionPackage (F10.8). A package is a
 * consumer-facing bundle of ready-to-use artifacts (JDBC URLs, curl commands,
 * Python snippets, data dictionaries) derived from the port's decrypted
 * connection details and its contract schema.
 *
 * The generator assumes the caller has already authorized the consumer to see
 * full connection details — the service itself does not perform access checks.
 */
@Injectable()
export class ConnectionPackageService {
  private readonly logger = new Logger(ConnectionPackageService.name);

  constructor(
    @InjectRepository(DataProductEntity)
    private readonly productRepo: Repository<DataProductEntity>,
    @InjectRepository(PortDeclarationEntity)
    private readonly portRepo: Repository<PortDeclarationEntity>,
    @InjectRepository(AccessGrantEntity)
    private readonly grantRepo: Repository<AccessGrantEntity>,
    private readonly encryptionService: EncryptionService,
  ) {}

  // ---------------------------------------------------------------------------
  // Per-port + per-destination snippet generation (consumer-grade outbound)
  // ---------------------------------------------------------------------------

  async generateSnippetForPort(
    productOrgId: string,
    productId: string,
    portId: string,
    destination: SnippetDestination,
    requesterPrincipalId: string,
  ): Promise<PortSnippetResponse | null> {
    const product = await this.productRepo.findOne({
      where: { id: productId, orgId: productOrgId },
    });
    if (!product) return null;

    const port = await this.portRepo.findOne({
      where: { id: portId, orgId: productOrgId, productId },
    });
    if (!port) return null;
    if (!port.interfaceType) {
      return {
        destination,
        language: snippetLanguageFor(destination),
        code: null,
        available: false,
        reason: 'unsupported_interface_type',
      };
    }

    const isOwner = product.ownerPrincipalId === requesterPrincipalId;
    const hasGrant = isOwner || (await this.hasActiveGrant(productOrgId, productId, requesterPrincipalId));
    // F10.15 layer 1 (Phase 5.9): a Situation-A-eligible port is producer-
    // declared open to all source-system principals. In that case the
    // connection details aren't sensitive in the F10.6 sense — the
    // consumer connects with their own existing source-system credentials
    // — so the snippet renders without a grant. The grant-or-owner check
    // still applies for default Situation-B ports.
    const isOpenAccess = port.situationAEligibility === true;

    if (!hasGrant && !isOpenAccess) {
      return {
        destination,
        language: snippetLanguageFor(destination),
        code: null,
        available: false,
        reason: 'request_access_required',
      };
    }

    // Semantic query endpoints have no decryptable connection_details — the
    // python snippet is platform-static.
    if (port.interfaceType === 'semantic_query_endpoint') {
      if (destination === 'python') {
        return {
          destination,
          language: 'python',
          code: SEMANTIC_PYTHON_SNIPPET,
          available: true,
        };
      }
      return {
        destination,
        language: snippetLanguageFor(destination),
        code: null,
        available: false,
        reason: 'destination_not_yet_supported',
      };
    }

    const details = await this.decryptPortDetails(port);
    if (!details) {
      return {
        destination,
        language: snippetLanguageFor(destination),
        code: null,
        available: false,
        reason: 'port_has_no_connection_details',
      };
    }

    // F10.14 / Phase 5.11 — resolve the catalog reference per the
    // precedence rule: explicit catalogName > F2.8a source_object_path >
    // null (snippet builders fall back to a placeholder for sql_jdbc).
    const catalogRef = port.catalogName ?? port.sourceObjectPath ?? null;
    const code = buildSnippet(details, destination, product.slug, catalogRef);
    if (code === null) {
      return {
        destination,
        language: snippetLanguageFor(destination),
        code: null,
        available: false,
        reason: 'destination_not_yet_supported',
      };
    }

    return {
      destination,
      language: snippetLanguageFor(destination),
      code,
      available: true,
    };
  }

  private async hasActiveGrant(
    orgId: string,
    productId: string,
    principalId: string,
  ): Promise<boolean> {
    const grant = await this.grantRepo.findOne({
      where: { orgId, productId, granteePrincipalId: principalId },
      order: { grantedAt: 'DESC' },
    });
    if (!grant) return false;
    if (grant.revokedAt) return false;
    if (grant.expiresAt && grant.expiresAt <= new Date()) return false;
    return true;
  }

  /**
   * F10.15 layer 1 (Phase 5.9) — Resolves the consumer-flow situation
   * for a given (port, caller) pair using producer declaration as the
   * primary signal:
   *
   * - Situation A: the producer marked the port `situationAEligibility = true`.
   *   The consumer can use the port immediately; no per-product grant
   *   is required. recommendedNext = 'view_snippet'.
   * - Situation B: the producer left the port at the default
   *   `situationAEligibility = false`. The consumer needs a per-product
   *   grant. recommendedNext = 'view_snippet' if the caller already
   *   has an active grant; 'request_access' otherwise.
   *
   * Returns null if the product or port doesn't exist (mapped to 404
   * at the controller).
   *
   * Layer 2 (probe-based verification) and layer 3 (directory
   * integration / Situation C detection) are separate follow-ups per
   * F10.15. Until they ship, this layer reports A or B only.
   */
  async resolveSituationForPort(
    productOrgId: string,
    productId: string,
    portId: string,
    requesterPrincipalId: string,
  ): Promise<PortSituationResponse | null> {
    const product = await this.productRepo.findOne({
      where: { id: productId, orgId: productOrgId },
    });
    if (!product) return null;

    const port = await this.portRepo.findOne({
      where: { id: portId, orgId: productOrgId, productId },
    });
    if (!port) return null;

    const isOwner = product.ownerPrincipalId === requesterPrincipalId;
    const hasGrant = isOwner
      || (await this.hasActiveGrant(productOrgId, productId, requesterPrincipalId));

    const declaredSituationAEligible = port.situationAEligibility === true;

    if (declaredSituationAEligible) {
      return {
        portId: port.id,
        productId: product.id,
        situation: 'A',
        recommendedNext: 'view_snippet',
        callerHasActiveGrant: hasGrant,
        declaredSituationAEligible: true,
      };
    }

    return {
      portId: port.id,
      productId: product.id,
      situation: 'B',
      recommendedNext: hasGrant ? 'view_snippet' : 'request_access',
      callerHasActiveGrant: hasGrant,
      declaredSituationAEligible: false,
    };
  }

  /**
   * F10.14 / Phase 5.11 — generate the source-side view DDL the producer
   * copies into their source system. Returns null when the port doesn't
   * exist; throws when prerequisites aren't met (caller renders the
   * error to the producer).
   *
   * Per Constraint 3 / ADR-011 the platform never executes this DDL — it
   * surfaces it for the producer to paste into their source system. The
   * shape varies trivially across PG / Snowflake / Databricks; the
   * single-statement `CREATE VIEW IF NOT EXISTS <catalog_name> AS SELECT
   * * FROM <source_object_path>;` is the conservative cross-dialect form
   * that parses across all three.
   *
   * Requires sql_jdbc interface + both `catalogName` and
   * `sourceObjectPath` set. For non-SQL interfaces (REST, GraphQL,
   * Kafka, file_export) the catalog-name abstraction is UI-only (the
   * snippet builders fall back to the source-system identifier
   * directly); no DDL is meaningful, so this endpoint returns null.
   *
   * Owner-only at the call site (producer-facing surface — only the
   * port owner needs the DDL). Controller applies the role check.
   */
  resolveSourceViewDdl(
    productOrgId: string,
    productId: string,
    portId: string,
  ): Promise<{
    available: boolean;
    ddl: string | null;
    reason?:
      | 'port_or_product_not_found'
      | 'unsupported_interface_type'
      | 'missing_catalog_name'
      | 'missing_source_object_path';
  } | null> {
    return (async () => {
      const product = await this.productRepo.findOne({
        where: { id: productId, orgId: productOrgId },
      });
      if (!product) return null;
      const port = await this.portRepo.findOne({
        where: { id: portId, orgId: productOrgId, productId },
      });
      if (!port) return null;

      if (port.interfaceType !== 'sql_jdbc') {
        return { available: false, ddl: null, reason: 'unsupported_interface_type' };
      }
      if (!port.catalogName) {
        return { available: false, ddl: null, reason: 'missing_catalog_name' };
      }
      if (!port.sourceObjectPath) {
        return { available: false, ddl: null, reason: 'missing_source_object_path' };
      }

      // The catalog name is an SQL identifier; the source_object_path
      // could be a qualified name (e.g. `prod.customer.events`). Neither
      // is wrapped in quotes — the producer's source system applies its
      // own identifier rules. Comment block tells them what to do.
      const ddl = [
        `-- Provenance F10.14 source-side view for port "${port.name}"`,
        `-- Generated for product "${product.name}". Paste into your source`,
        `-- system to back the catalog name "${port.catalogName}" with a view`,
        `-- over the physical source path. Drop and recreate (CREATE OR`,
        `-- REPLACE) is safe if the underlying source changes.`,
        ``,
        `CREATE OR REPLACE VIEW ${port.catalogName} AS`,
        `SELECT * FROM ${port.sourceObjectPath};`,
      ].join('\n');

      return { available: true, ddl };
    })();
  }

  async generateForProduct(orgId: string, productId: string): Promise<ConnectionPackage | null> {
    const product = await this.productRepo.findOne({ where: { id: productId, orgId } });
    if (!product) return null;

    const ports = await this.portRepo.find({
      where: { orgId, productId, portType: 'output' },
      order: { createdAt: 'ASC' },
    });
    if (ports.length === 0) return null;

    const built: ConnectionPackagePort[] = [];
    let anyAgentAccessible = false;
    for (const port of ports) {
      const artifacts = await this.buildPortArtifacts(port);
      if (!artifacts) continue;
      anyAgentAccessible = anyAgentAccessible || artifacts.agentAccessible;
      built.push({
        portId: port.id,
        portName: port.name,
        interfaceType: artifacts.interfaceType,
        artifacts: artifacts.artifacts,
      });
    }

    if (built.length === 0) return null;

    const pkg: ConnectionPackage = {
      packageVersion: 1,
      generatedAt: new Date().toISOString(),
      ports: built,
    };
    if (anyAgentAccessible) {
      pkg.agentIntegration = this.buildAgentIntegration(product);
    }
    return pkg;
  }

  // ---------------------------------------------------------------------------
  // Per-interface-type artifact builders
  // ---------------------------------------------------------------------------

  private async buildPortArtifacts(port: PortDeclarationEntity): Promise<PortArtifacts | null> {
    if (!port.interfaceType) return null;

    // Semantic query endpoints have no user-supplied connection details — the
    // artifact set is derived from the platform contract only.
    if (port.interfaceType === 'semantic_query_endpoint') {
      return {
        interfaceType: 'semantic_query_endpoint',
        agentAccessible: true,
        artifacts: {
          mcpTools: ['semantic_search', 'get_product', 'get_lineage'],
          pythonSnippet: SEMANTIC_PYTHON_SNIPPET,
        },
      };
    }

    const details = await this.decryptPortDetails(port);
    if (!details) return null;

    switch (details.kind) {
      case 'sql_jdbc':
        return {
          interfaceType: 'sql_jdbc',
          agentAccessible: false,
          artifacts: this.buildSqlJdbcArtifacts(details, port.contractSchema),
        };
      case 'rest_api':
        return {
          interfaceType: 'rest_api',
          agentAccessible: false,
          artifacts: this.buildRestApiArtifacts(details),
        };
      case 'graphql':
        return {
          interfaceType: 'graphql',
          agentAccessible: false,
          artifacts: this.buildGraphQlArtifacts(details),
        };
      case 'streaming_topic':
        return {
          interfaceType: 'streaming_topic',
          agentAccessible: false,
          artifacts: this.buildKafkaArtifacts(details),
        };
      case 'file_object_export':
        return {
          interfaceType: 'file_object_export',
          agentAccessible: false,
          artifacts: this.buildFileExportArtifacts(details),
        };
      default:
        return null;
    }
  }

  private async decryptPortDetails(port: PortDeclarationEntity): Promise<ConnectionDetails | null> {
    if (port.connectionDetails === null) return null;
    try {
      if (port.connectionDetailsEncrypted) {
        if (!EncryptionService.isEnvelope(port.connectionDetails)) return null;
        return await this.encryptionService.decrypt<ConnectionDetails>(
          port.connectionDetails as unknown as EncryptedEnvelope,
        );
      }
      return port.connectionDetails as unknown as ConnectionDetails;
    } catch (err) {
      this.logger.warn(
        `Skipping port ${port.id} in connection package: decrypt failed (${(err as Error).message})`,
      );
      return null;
    }
  }

  private buildSqlJdbcArtifacts(
    d: SqlJdbcConnectionDetails,
    contractSchema: Record<string, unknown> | null,
  ): Record<string, unknown> {
    const driver = this.inferJdbcDriver(d);
    const jdbcUrl =
      d.jdbcUrlTemplate && d.jdbcUrlTemplate.length > 0
        ? d.jdbcUrlTemplate
        : `jdbc:${driver}://${d.host}:${d.port}/${d.database}?sslmode=${d.sslMode}`;
    const dataDictionary = extractColumns(contractSchema);
    const columnList =
      dataDictionary.length > 0
        ? dataDictionary.map((c) => c.name).join(', ')
        : '*';
    const sampleQuery = `SELECT ${columnList} FROM ${d.schema}.${d.database === d.schema ? d.database : d.database} LIMIT 100;`;
    return {
      jdbcUrl,
      driver,
      // Legacy connection-package path (F10.8) — port object isn't
      // threaded here; pass null catalogRef and fall back to the
      // schema.<table> placeholder. The per-port snippet endpoint
      // (generateSnippetForPort) does the catalog-name resolution.
      pythonSnippet: buildSqlJdbcPython(d, null),
      sampleQuery,
      dataDictionary,
    };
  }

  private buildRestApiArtifacts(d: RestApiConnectionDetails): Record<string, unknown> {
    const authHeader = restAuthHeader(d);
    const curlExample =
      `curl '${d.baseUrl}'` +
      (authHeader ? ` \\\n  -H '${authHeader}'` : '') +
      (d.apiVersion ? ` \\\n  -H 'Accept-Version: ${d.apiVersion}'` : '');
    return {
      curlExample,
      pythonSnippet: buildRestPython(d),
      endpointReference: { baseUrl: d.baseUrl, apiVersion: d.apiVersion ?? null, authMethod: d.authMethod },
      postmanCollection: buildPostmanCollection(d),
    };
  }

  private buildGraphQlArtifacts(d: GraphQlConnectionDetails): Record<string, unknown> {
    return {
      endpointUrl: d.endpointUrl,
      exampleQuery: 'query { __typename }',
      pythonSnippet: buildGraphQlPython(d),
    };
  }

  private buildKafkaArtifacts(d: KafkaConnectionDetails): Record<string, unknown> {
    return {
      consumerConfig: buildKafkaConsumerConfig(d),
      pythonSnippet: buildKafkaPython(d),
      schemaRegistryUrl: d.schemaRegistryUrl ?? null,
    };
  }

  private buildFileExportArtifacts(d: FileExportConnectionDetails): Record<string, unknown> {
    return {
      cliCommand: buildFileCliCommand(d),
      pythonSnippet: buildFilePython(d),
      fileFormat: d.fileFormat,
      compression: d.compression ?? 'none',
    };
  }

  private buildAgentIntegration(
    product: Pick<DataProductEntity, 'id' | 'name'>,
  ): NonNullable<ConnectionPackage['agentIntegration']> {
    return {
      mcpToolCalls: [
        `get_product("${product.id}")`,
        `semantic_search("<your question>")`,
        `get_lineage("${product.id}")`,
      ],
      examplePrompt: `Find the most up-to-date version of "${product.name}" and summarize its contract.`,
      trustScore: null,
      governancePolicyVersion: null,
    };
  }

  private inferJdbcDriver(d: SqlJdbcConnectionDetails): string {
    if (d.host.includes('snowflakecomputing.com') || d.port === 443) return 'snowflake';
    if (d.port === 3306) return 'mysql';
    return 'postgresql';
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — kept outside the class so they stay easy to unit-test.
// ---------------------------------------------------------------------------

interface DataDictionaryColumn {
  name: string;
  type: string;
  description: string | null;
}

function extractColumns(schema: Record<string, unknown> | null): DataDictionaryColumn[] {
  if (!schema) return [];
  const properties = schema['properties'] as Record<string, unknown> | undefined;
  if (!properties || typeof properties !== 'object') return [];
  return Object.entries(properties).map(([name, def]) => {
    const field = (def as Record<string, unknown>) ?? {};
    return {
      name,
      type: (field['type'] as string | undefined) ?? 'unknown',
      description: (field['description'] as string | undefined) ?? null,
    };
  });
}

/**
 * Derives the Snowflake account identifier from the host by stripping the
 * `.snowflakecomputing.com` suffix (e.g.
 * `uj37996.us-east-2.aws.snowflakecomputing.com` → `uj37996.us-east-2.aws`).
 */
function snowflakeAccount(host: string): string {
  return host.replace(/\.snowflakecomputing\.com$/, '');
}

function buildSqlJdbcPython(d: SqlJdbcConnectionDetails, catalogRef: string | null): string {
  const tableRef = catalogRef ?? `${d.schema}.<table>`;
  if (d.host.includes('snowflakecomputing.com')) {
    const account = snowflakeAccount(d.host);
    const warehouse = d.warehouse ?? '<your_warehouse>';
    const role = d.role ?? '<your_role>';
    return [
      'import snowflake.connector',
      'conn = snowflake.connector.connect(',
      `    account=${quote(account)},`,
      `    user=${quote('<set via env>')},`,
      `    password=${quote('<set via env>')},`,
      `    warehouse=${quote(warehouse)},`,
      `    database=${quote(d.database)},`,
      `    schema=${quote(d.schema)},`,
      `    role=${quote(role)},`,
      ')',
      'cur = conn.cursor()',
      `cur.execute(${quote(`SELECT * FROM ${tableRef} LIMIT 10`)})`,
      'for row in cur.fetchall():',
      '    print(row)',
    ].join('\n');
  }
  return [
    'import psycopg2',
    'conn = psycopg2.connect(',
    `    host=${quote(d.host)},`,
    `    port=${d.port},`,
    `    dbname=${quote(d.database)},`,
    `    sslmode=${quote(d.sslMode)},`,
    `    user=${quote(d.username ?? '<set via env>')},`,
    `    password=${quote('<set via env>')},`,
    ')',
    'with conn.cursor() as cur:',
    `    cur.execute(${quote(`SELECT * FROM ${tableRef} LIMIT 10;`)})`,
    '    for row in cur.fetchall():',
    '        print(row)',
  ].join('\n');
}

function restAuthHeader(d: RestApiConnectionDetails): string | null {
  switch (d.authMethod) {
    case 'bearer_token':
      return `Authorization: Bearer ${d.bearerToken ?? '<token>'}`;
    case 'api_key':
      return `X-API-Key: ${d.apiKey ?? '<api-key>'}`;
    case 'oauth2':
      return `Authorization: Bearer <obtained from ${d.oauth2TokenUrl ?? 'token endpoint'}>`;
    default:
      return null;
  }
}

function buildRestPython(d: RestApiConnectionDetails): string {
  const headerLine = (() => {
    switch (d.authMethod) {
      case 'bearer_token':
        return 'headers = {"Authorization": f"Bearer {TOKEN}"}';
      case 'api_key':
        return 'headers = {"X-API-Key": API_KEY}';
      case 'oauth2':
        return 'headers = {"Authorization": f"Bearer {oauth2_token}"}';
      default:
        return 'headers = {}';
    }
  })();
  return [
    'import requests',
    headerLine,
    `response = requests.get(${quote(d.baseUrl)}, headers=headers)`,
    'response.raise_for_status()',
    'print(response.json())',
  ].join('\n');
}

function buildPostmanCollection(d: RestApiConnectionDetails): Record<string, unknown> {
  return {
    info: { name: 'Provenance connection package', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: [
      {
        name: 'GET base',
        request: {
          method: 'GET',
          url: d.baseUrl,
          header:
            d.authMethod === 'bearer_token'
              ? [{ key: 'Authorization', value: 'Bearer {{token}}' }]
              : d.authMethod === 'api_key'
              ? [{ key: 'X-API-Key', value: '{{api_key}}' }]
              : [],
        },
      },
    ],
  };
}

function buildGraphQlPython(d: GraphQlConnectionDetails): string {
  return [
    'from gql import gql, Client',
    'from gql.transport.requests import RequestsHTTPTransport',
    `transport = RequestsHTTPTransport(url=${quote(d.endpointUrl)})`,
    'client = Client(transport=transport)',
    'result = client.execute(gql("query { __typename }"))',
    'print(result)',
  ].join('\n');
}

function buildKafkaConsumerConfig(d: KafkaConnectionDetails): string {
  const lines = [
    `bootstrap.servers=${d.bootstrapServers}`,
    `group.id=${d.consumerGroupPrefix ?? 'provenance'}-${d.topic}`,
    'auto.offset.reset=earliest',
    'enable.auto.commit=true',
  ];
  switch (d.authMethod) {
    case 'sasl_plain':
      lines.push('security.protocol=SASL_SSL', 'sasl.mechanism=PLAIN');
      break;
    case 'sasl_scram':
      lines.push('security.protocol=SASL_SSL', 'sasl.mechanism=SCRAM-SHA-256');
      break;
    case 'mtls':
      lines.push('security.protocol=SSL');
      break;
    default:
      lines.push('security.protocol=PLAINTEXT');
  }
  return lines.join('\n');
}

function buildKafkaPython(d: KafkaConnectionDetails): string {
  return [
    'from kafka import KafkaConsumer',
    'consumer = KafkaConsumer(',
    `    ${quote(d.topic)},`,
    `    bootstrap_servers=${quote(d.bootstrapServers)},`,
    `    group_id="provenance-${d.topic}",`,
    ')',
    'for message in consumer:',
    '    print(message.value)',
  ].join('\n');
}

function buildFileCliCommand(d: FileExportConnectionDetails): string {
  switch (d.storage) {
    case 's3':
      return `aws s3 ls s3://${d.bucket}/${d.pathPrefix}`;
    case 'gcs':
      return `gsutil ls gs://${d.bucket}/${d.pathPrefix}`;
    case 'adls':
      return `azcopy list 'https://${d.bucket}.dfs.core.windows.net/${d.pathPrefix}'`;
  }
}

function buildFilePython(d: FileExportConnectionDetails): string {
  switch (d.storage) {
    case 's3':
      return [
        'import boto3',
        's3 = boto3.client("s3")',
        `response = s3.list_objects_v2(Bucket=${quote(d.bucket)}, Prefix=${quote(d.pathPrefix)})`,
        'for obj in response.get("Contents", []):',
        '    print(obj["Key"])',
      ].join('\n');
    case 'gcs':
      return [
        'from google.cloud import storage',
        'client = storage.Client()',
        `bucket = client.bucket(${quote(d.bucket)})`,
        `for blob in bucket.list_blobs(prefix=${quote(d.pathPrefix)}):`,
        '    print(blob.name)',
      ].join('\n');
    case 'adls':
      return [
        'from azure.storage.blob import BlobServiceClient',
        `client = BlobServiceClient.from_connection_string(CONN_STR).get_container_client(${quote(d.bucket)})`,
        `for blob in client.list_blobs(name_starts_with=${quote(d.pathPrefix)}):`,
        '    print(blob.name)',
      ].join('\n');
  }
}

function quote(s: string): string {
  return JSON.stringify(s);
}

// ---------------------------------------------------------------------------
// Per-destination snippet dispatch.
//
// Returns null when the (interface, destination) pair isn't supported tonight.
// The dbt destination is sql_jdbc-only; sql_client / jdbc / power_bi / tableau
// are sql_jdbc-only too but only minimally implemented (sql_client / jdbc are
// the raw JDBC URL string; power_bi / tableau are deferred).
// ---------------------------------------------------------------------------

function snippetLanguageFor(destination: SnippetDestination): SnippetLanguage {
  switch (destination) {
    case 'python':   return 'python';
    case 'dbt':      return 'yaml';
    case 'power_bi': return 'json';
    case 'tableau':  return 'xml';
    default:         return 'text';
  }
}

function buildSnippet(
  details: ConnectionDetails,
  destination: SnippetDestination,
  productSlug: string,
  catalogRef: string | null,
): string | null {
  if (destination === 'python') {
    switch (details.kind) {
      case 'sql_jdbc':          return buildSqlJdbcPython(details, catalogRef);
      case 'rest_api':          return buildRestPython(details);
      case 'graphql':           return buildGraphQlPython(details);
      case 'streaming_topic':   return buildKafkaPython(details);
      case 'file_object_export': return buildFilePython(details);
      default:                  return null;
    }
  }
  if (destination === 'dbt') {
    if (details.kind === 'sql_jdbc') return buildSqlJdbcDbt(details, productSlug, catalogRef);
    return null;
  }
  if (destination === 'sql_client' || destination === 'jdbc') {
    if (details.kind === 'sql_jdbc') return buildSqlJdbcUrl(details);
    return null;
  }
  if (destination === 'power_bi') {
    if (details.kind === 'sql_jdbc') return buildSqlJdbcPowerBiPbids(details);
    return null;
  }
  if (destination === 'tableau') {
    if (details.kind === 'sql_jdbc') return buildSqlJdbcTableauTds(details, productSlug);
    return null;
  }
  return null;
}

/**
 * dbt profiles.yml entry for a Postgres / Snowflake / Databricks JDBC port.
 * The output is intended to be pasted into ~/.dbt/profiles.yml under a new
 * profile name; the consumer fills in the user/password via env vars.
 */
function buildSqlJdbcDbt(
  d: SqlJdbcConnectionDetails,
  productSlug: string,
  catalogRef: string | null,
): string {
  const profileName = `provenance_${productSlug.replace(/-/g, '_')}`;
  const isSnowflake = d.host.includes('snowflakecomputing.com');
  let lines: string[];
  if (isSnowflake) {
    const account = snowflakeAccount(d.host);
    const warehouse = d.warehouse ?? '<your_warehouse>';
    const role = d.role ?? '<your_role>';
    lines = [
      `${profileName}:`,
      `  target: dev`,
      `  outputs:`,
      `    dev:`,
      `      type: snowflake`,
      `      account: ${account}`,
      `      user: "{{ env_var('DBT_USER') }}"`,
      `      password: "{{ env_var('DBT_PASSWORD') }}"`,
      `      role: ${role}`,
      `      warehouse: ${warehouse}`,
      `      database: ${d.database}`,
      `      schema: ${d.schema}`,
      `      threads: 4`,
    ];
  } else {
    const driver = (() => {
      if (d.host.includes('databricks')) return 'databricks';
      if (d.port === 3306) return 'mysql';
      return 'postgres';
    })();
    lines = [
      `${profileName}:`,
      `  target: dev`,
      `  outputs:`,
      `    dev:`,
      `      type: ${driver}`,
      `      host: ${d.host}`,
      `      port: ${d.port}`,
      `      database: ${d.database}`,
      `      schema: ${d.schema}`,
      `      user: "{{ env_var('DBT_USER') }}"`,
      `      password: "{{ env_var('DBT_PASSWORD') }}"`,
      `      sslmode: ${d.sslMode}`,
      `      threads: 4`,
    ];
  }
  if (catalogRef) {
    // F10.14 — show the producer how to reference the catalog name as a
    // dbt source. Commented so it doesn't break a profiles.yml paste if
    // the user only wants the connection profile.
    lines.push('');
    lines.push(`# Reference the catalog name in your dbt model:`);
    lines.push(`#   {{ source('${profileName}', '${catalogRef}') }}`);
  }
  return lines.join('\n');
}

/**
 * Bare JDBC URL — the same value the connection package's `jdbcUrl` artifact
 * carries. Exposed under both `sql_client` and `jdbc` destinations so a user
 * picking either gets the URL string to paste into their tool's connection
 * dialog.
 */
function buildSqlJdbcUrl(d: SqlJdbcConnectionDetails): string {
  if (d.jdbcUrlTemplate && d.jdbcUrlTemplate.length > 0) return d.jdbcUrlTemplate;
  if (d.host.includes('snowflakecomputing.com')) {
    // Snowflake JDBC URL: no port, params as query string.
    const params = new URLSearchParams();
    params.set('warehouse', d.warehouse ?? '<your_warehouse>');
    params.set('db', d.database);
    params.set('schema', d.schema);
    params.set('role', d.role ?? '<your_role>');
    return `jdbc:snowflake://${d.host}/?${params.toString()}`;
  }
  const driver = (() => {
    if (d.port === 3306) return 'mysql';
    return 'postgresql';
  })();
  return `jdbc:${driver}://${d.host}:${d.port}/${d.database}?sslmode=${d.sslMode}`;
}

/**
 * Power BI Data Source file (.pbids) for a SQL/JDBC port — Phase 5.10.
 *
 * The output is a JSON document the consumer saves to a `.pbids` file
 * (e.g. `customer-orders.pbids`) and double-clicks. Power BI Desktop
 * launches with the connection dialog pre-filled with host + database;
 * the consumer enters their own credentials per ADR-011 (the platform
 * never holds the consumer's source-system credentials).
 *
 * Per-protocol mapping using the same host/port heuristic as the dbt
 * and JDBC builders (so a Postgres port renders a postgresql .pbids,
 * a Snowflake port renders a snowflake .pbids, etc.). The Snowflake
 * .pbids address includes `server`, `warehouse` (from the contract
 * `warehouse` field — Phase 5.14 Part B), and `database`. Power BI's
 * `databricks-sql` protocol additionally needs a SQL-warehouse path
 * that isn't in the SqlJdbcConnectionDetails contract today — the
 * .pbids omits the path; Power BI prompts the consumer for it on first
 * connect.
 *
 * References: Microsoft .pbids spec
 * (learn.microsoft.com/en-us/power-bi/connect-data/desktop-data-sources).
 */
function buildSqlJdbcPowerBiPbids(d: SqlJdbcConnectionDetails): string {
  const protocol = pickPowerBiProtocol(d);
  const address: Record<string, string> = d.host.includes('snowflakecomputing.com')
    ? {
        server: d.host,
        warehouse: d.warehouse ?? '<your_warehouse>',
        database: d.database,
      }
    : {
        server: d.host,
        database: d.database,
      };
  const pbids = {
    version: '0.1',
    connections: [
      {
        details: { protocol, address },
        // Import is the default; DirectQuery is also supported but
        // requires the source to expose live-query semantics.
        // Defaulting to Import keeps the .pbids broadly compatible.
        mode: 'Import',
      },
    ],
  };
  return JSON.stringify(pbids, null, 2);
}

function pickPowerBiProtocol(d: SqlJdbcConnectionDetails): string {
  if (d.host.includes('snowflakecomputing.com')) return 'snowflake';
  if (d.host.includes('databricks')) return 'databricks-sql';
  if (d.port === 3306) return 'mysql';
  // tds is SQL Server; Provenance doesn't model a SQL Server connector
  // type today, so postgresql is the catch-all for the remaining
  // sql_jdbc variants until SQL Server lands.
  return 'postgresql';
}

/**
 * Tableau Data Source file (.tds) for a SQL/JDBC port — Phase 5.10.
 *
 * The output is an XML document the consumer saves to a `.tds` file
 * (e.g. `customer-orders.tds`) and double-clicks. Tableau Desktop
 * launches with the connection dialog pre-filled with host + database;
 * the consumer enters their own credentials per ADR-011 (the platform
 * never holds the consumer's source-system credentials).
 *
 * Per-class mapping mirrors the dbt / JDBC URL / Power BI builders'
 * host-detection heuristic. Tableau's `databricks_aws` class is the
 * conservative pick for Databricks workspaces — newer Tableau versions
 * also expose `databricks` (with an HTTP path for SQL warehouses),
 * but `databricks_aws` parses across more Tableau versions. The exact
 * connection attributes Tableau accepts vary by version; this builder
 * emits the minimum set (`server`, `dbname`, optional `port` and
 * `authentication`) so the .tds is broadly compatible. The consumer
 * fills in any version-specific fields in Tableau's connection dialog
 * after the .tds opens.
 *
 * References: Tableau TDS file format documentation
 * (help.tableau.com — XML format spec).
 */
function buildSqlJdbcTableauTds(d: SqlJdbcConnectionDetails, productSlug: string): string {
  const tableauClass = pickTableauClass(d);
  const attrs: string[] = [`class='${tableauClass}'`];
  if (tableauClass === 'snowflake') {
    // Snowflake Tableau connector expects: server, warehouse, dbname, schema.
    // Port is implicit (443); role is not a standard .tds attribute.
    attrs.push(`server='${xmlEscape(d.host)}'`);
    attrs.push(`warehouse='${xmlEscape(d.warehouse ?? '<your_warehouse>')}'`);
    attrs.push(`dbname='${xmlEscape(d.database)}'`);
    attrs.push(`schema='${xmlEscape(d.schema)}'`);
  } else {
    attrs.push(`server='${xmlEscape(d.host)}'`);
    attrs.push(`dbname='${xmlEscape(d.database)}'`);
    // Snowflake on port 443 + Databricks SQL are implicit-port; only emit
    // the port attr where Tableau actually expects it as a discriminator.
    if (tableauClass === 'postgres' || tableauClass === 'mysql') {
      attrs.push(`port='${d.port}'`);
    }
  }
  // The authentication attribute is informational at the .tds level —
  // it tells Tableau which credential prompt to show. Map our internal
  // authMethod onto Tableau's vocabulary.
  const tableauAuth = pickTableauAuth(d.authMethod);
  if (tableauAuth) {
    attrs.push(`authentication='${tableauAuth}'`);
  }
  return [
    `<?xml version='1.0' encoding='utf-8'?>`,
    `<datasource formatted-name='${xmlEscape(productSlug)}' version='10.5' inline='true'>`,
    `  <connection ${attrs.join(' ')}>`,
    `  </connection>`,
    `</datasource>`,
  ].join('\n');
}

function pickTableauClass(d: SqlJdbcConnectionDetails): string {
  if (d.host.includes('snowflakecomputing.com')) return 'snowflake';
  if (d.host.includes('databricks')) return 'databricks_aws';
  if (d.port === 3306) return 'mysql';
  return 'postgres';
}

function pickTableauAuth(authMethod: SqlJdbcConnectionDetails['authMethod']): string | null {
  switch (authMethod) {
    case 'username_password': return 'username-password';
    case 'iam':               return 'iam';
    case 'certificate':       return 'certificate';
    default:                  return null;
  }
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;')
    .replace(/"/g, '&quot;');
}

const SEMANTIC_PYTHON_SNIPPET = [
  'from mcp.client.sse import sse_client',
  'from mcp import ClientSession',
  '',
  'async with sse_client(url="https://agents.example.com/mcp") as (read, write):',
  '    async with ClientSession(read, write) as session:',
  '        await session.initialize()',
  '        result = await session.call_tool("semantic_search", {"q": "<your question>"})',
  '        print(result)',
].join('\n');
