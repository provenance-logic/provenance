import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

interface AuditEntryDto {
  org_id: string;
  principal_id: string;
  principal_type: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  agent_id?: string;
  agent_trust_classification_at_time?: string;
  human_oversight_contact?: string;
  tool_name?: string;
  mcp_input_summary?: string;
  metadata?: Record<string, unknown>;
}

@UseGuards(JwtAuthGuard)
@Controller('internal/audit')
export class AuditController {
  private readonly logger = new Logger(AuditController.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async writeAuditEntry(@Body() dto: AuditEntryDto) {
    try {
      await this.dataSource.query(
        `INSERT INTO audit.audit_log
         (org_id, principal_id, principal_type, action, resource_type, resource_id,
          metadata, agent_id, agent_trust_classification_at_time,
          human_oversight_contact, tool_name, mcp_input_summary)
         VALUES ($1, $2::uuid, $3, $4, $5, $6::uuid, $7, $8::uuid, $9, $10, $11, $12)`,
        [
          dto.org_id,
          dto.principal_id || null,
          dto.principal_type,
          dto.action,
          dto.resource_type,
          dto.resource_id || null,
          dto.metadata ? JSON.stringify(dto.metadata) : null,
          dto.agent_id || null,
          dto.agent_trust_classification_at_time || null,
          dto.human_oversight_contact || null,
          dto.tool_name || null,
          dto.mcp_input_summary || null,
        ],
      );
      return { status: 'ok' };
    } catch (err) {
      this.logger.error('Failed to write audit entry', err);
      return { status: 'error', message: (err as Error).message };
    }
  }
}
