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

export type SnippetLanguage = 'python' | 'yaml' | 'text' | 'json';

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

    if (!hasGrant) {
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

    const code = buildSnippet(details, destination, product.slug);
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
      pythonSnippet: buildSqlJdbcPython(d),
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

function buildSqlJdbcPython(d: SqlJdbcConnectionDetails): string {
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
    default:         return 'text';
  }
}

function buildSnippet(
  details: ConnectionDetails,
  destination: SnippetDestination,
  productSlug: string,
): string | null {
  if (destination === 'python') {
    switch (details.kind) {
      case 'sql_jdbc':          return buildSqlJdbcPython(details);
      case 'rest_api':          return buildRestPython(details);
      case 'graphql':           return buildGraphQlPython(details);
      case 'streaming_topic':   return buildKafkaPython(details);
      case 'file_object_export': return buildFilePython(details);
      default:                  return null;
    }
  }
  if (destination === 'dbt') {
    if (details.kind === 'sql_jdbc') return buildSqlJdbcDbt(details, productSlug);
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
  // tableau — deferred. Snippet endpoint returns available=false with
  // reason='destination_not_yet_supported'.
  return null;
}

/**
 * dbt profiles.yml entry for a Postgres / Snowflake / Databricks JDBC port.
 * The output is intended to be pasted into ~/.dbt/profiles.yml under a new
 * profile name; the consumer fills in the user/password via env vars.
 */
function buildSqlJdbcDbt(d: SqlJdbcConnectionDetails, productSlug: string): string {
  const driver = (() => {
    if (d.host.includes('snowflakecomputing.com') || d.port === 443) return 'snowflake';
    if (d.host.includes('databricks')) return 'databricks';
    if (d.port === 3306) return 'mysql';
    return 'postgres';
  })();
  const profileName = `provenance_${productSlug.replace(/-/g, '_')}`;
  const lines = [
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
  const driver = (() => {
    if (d.host.includes('snowflakecomputing.com') || d.port === 443) return 'snowflake';
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
 * a Snowflake port renders a snowflake .pbids, etc.). Power BI's
 * `databricks-sql` protocol additionally needs a SQL-warehouse path
 * that isn't in the SqlJdbcConnectionDetails contract today — the
 * .pbids omits the path; Power BI prompts the consumer for it on first
 * connect. Tracked as a follow-up enhancement when the connection-
 * detail contract grows a `warehousePath` field.
 *
 * References: Microsoft .pbids spec
 * (learn.microsoft.com/en-us/power-bi/connect-data/desktop-data-sources).
 */
function buildSqlJdbcPowerBiPbids(d: SqlJdbcConnectionDetails): string {
  const protocol = pickPowerBiProtocol(d);
  const address: Record<string, string> = {
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
