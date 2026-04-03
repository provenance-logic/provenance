import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ReqContext } from '../auth/request-context.decorator.js';
import { GovernanceService } from './governance.service.js';
import type {
  RequestContext,
  PolicyDomain,
  PublishPolicyRequest,
  PolicyImpactPreviewRequest,
  ComplianceStateValue,
  TriggerEvaluationRequest,
  GrantExceptionRequest,
  GracePeriodOutcome,
} from '@provenance/types';

@UseGuards(JwtAuthGuard)
@Controller('organizations/:orgId/governance')
export class GovernanceController {
  constructor(private readonly governanceService: GovernanceService) {}

  // ---------------------------------------------------------------------------
  // Policy Schemas
  // ---------------------------------------------------------------------------

  @Get('policy-schemas')
  listPolicySchemas(
    @Param('orgId') orgId: string,
    @Query('policyDomain') policyDomain?: PolicyDomain,
  ) {
    return this.governanceService.listPolicySchemas(orgId, policyDomain);
  }

  @Get('policy-schemas/:domain')
  getPolicySchema(
    @Param('orgId') orgId: string,
    @Param('domain') domain: PolicyDomain,
  ) {
    return this.governanceService.getPolicySchemaByDomain(orgId, domain);
  }

  // ---------------------------------------------------------------------------
  // Policy Versions
  // ---------------------------------------------------------------------------

  @Get('policy-versions')
  listPolicyVersions(
    @Param('orgId') orgId: string,
    @Query('policyDomain') policyDomain?: PolicyDomain,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    return this.governanceService.listPolicyVersions(
      orgId,
      Number(limit),
      Number(offset),
      policyDomain,
    );
  }

  @Post('policy-versions')
  @HttpCode(HttpStatus.CREATED)
  publishPolicyVersion(
    @Param('orgId') orgId: string,
    @Body() dto: PublishPolicyRequest,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.governanceService.publishPolicyVersion(orgId, dto, ctx.principalId);
  }

  @Get('policy-versions/:versionId')
  getPolicyVersion(
    @Param('orgId') orgId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.governanceService.getPolicyVersion(orgId, versionId);
  }

  // ---------------------------------------------------------------------------
  // Policy Impact Preview
  // ---------------------------------------------------------------------------

  @Post('policy-preview')
  @HttpCode(HttpStatus.OK)
  previewImpact(
    @Param('orgId') orgId: string,
    @Body() dto: PolicyImpactPreviewRequest,
  ) {
    return this.governanceService.previewImpact(orgId, dto);
  }

  // ---------------------------------------------------------------------------
  // Effective Policies
  // ---------------------------------------------------------------------------

  @Get('effective-policies')
  listEffectivePolicies(
    @Param('orgId') orgId: string,
    @Query('scopeType') scopeType?: string,
  ) {
    return this.governanceService.listEffectivePolicies(orgId, scopeType);
  }

  @Get('effective-policies/:domain')
  getEffectivePolicy(
    @Param('orgId') orgId: string,
    @Param('domain') domain: PolicyDomain,
  ) {
    return this.governanceService.getEffectivePolicyByDomain(orgId, domain);
  }

  // ---------------------------------------------------------------------------
  // Compliance
  // ---------------------------------------------------------------------------

  @Get('compliance')
  listComplianceStates(
    @Param('orgId') orgId: string,
    @Query('state') state?: ComplianceStateValue,
    @Query('domainId') domainId?: string,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    return this.governanceService.listComplianceStates(
      orgId,
      Number(limit),
      Number(offset),
      state,
      domainId,
    );
  }

  @Post('compliance/evaluate')
  @HttpCode(HttpStatus.OK)
  triggerEvaluation(
    @Param('orgId') orgId: string,
    @Body() dto: TriggerEvaluationRequest,
  ) {
    return this.governanceService.triggerEvaluation(orgId, dto);
  }

  @Get('compliance/:productId')
  getComplianceState(
    @Param('orgId') orgId: string,
    @Param('productId') productId: string,
  ) {
    return this.governanceService.getComplianceStateByProduct(orgId, productId);
  }

  // ---------------------------------------------------------------------------
  // Exceptions
  // ---------------------------------------------------------------------------

  @Get('exceptions')
  listExceptions(
    @Param('orgId') orgId: string,
    @Query('productId') productId?: string,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    return this.governanceService.listExceptions(orgId, Number(limit), Number(offset), productId);
  }

  @Post('exceptions')
  @HttpCode(HttpStatus.CREATED)
  grantException(
    @Param('orgId') orgId: string,
    @Body() dto: GrantExceptionRequest,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.governanceService.grantException(orgId, dto, ctx.principalId);
  }

  @Get('exceptions/:exceptionId')
  getException(
    @Param('orgId') orgId: string,
    @Param('exceptionId') exceptionId: string,
  ) {
    return this.governanceService.getException(orgId, exceptionId);
  }

  // Returns 200 with the updated exception object (not 204) — matches governance.yaml.
  @Delete('exceptions/:exceptionId')
  @HttpCode(HttpStatus.OK)
  revokeException(
    @Param('orgId') orgId: string,
    @Param('exceptionId') exceptionId: string,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.governanceService.revokeException(orgId, exceptionId, ctx.principalId);
  }

  // ---------------------------------------------------------------------------
  // Grace Periods
  // ---------------------------------------------------------------------------

  @Get('grace-periods')
  listGracePeriods(
    @Param('orgId') orgId: string,
    @Query('outcome') outcome?: GracePeriodOutcome,
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    return this.governanceService.listGracePeriods(orgId, Number(limit), Number(offset), outcome);
  }

  @Get('grace-periods/:gracePeriodId')
  getGracePeriod(
    @Param('orgId') orgId: string,
    @Param('gracePeriodId') gracePeriodId: string,
  ) {
    return this.governanceService.getGracePeriod(orgId, gracePeriodId);
  }
}
