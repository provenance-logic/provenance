import { Injectable } from '@nestjs/common';
import type { PolicyDomain } from '@provenance/types';

// ---------------------------------------------------------------------------
// Governance rule descriptor types
//
// These are the supported rule types for the product_schema policy domain.
// The rules JSONB in policy_versions uses this shape as input to the compiler.
// Additional rule types can be added here as the platform matures.
// ---------------------------------------------------------------------------

interface RequirePortTypeRule {
  id: string;
  type: 'require_port_type';
  description?: string;
  config: { portType: string; minCount: number };
}

interface RequireFieldNonEmptyRule {
  id: string;
  type: 'require_field_non_empty';
  description?: string;
  config: { field: string };
}

interface RequireClassificationLevelRule {
  id: string;
  type: 'require_classification_level';
  description?: string;
  config: { allowedValues: string[] };
}

type GovernanceRule =
  | RequirePortTypeRule
  | RequireFieldNonEmptyRule
  | RequireClassificationLevelRule
  | { id: string; type: string; description?: string; config?: unknown };

interface GovernanceRulesPayload {
  rules: GovernanceRule[];
}

/**
 * Compiles governance rules JSON into Rego policy text for upload to OPA.
 *
 * Naming conventions:
 *   Package:         provenance.governance.{domain}.org_{orgNorm}
 *   OPA policy ID:   provenance_governance_{domain}_org_{orgNorm}
 *   OPA data path:   provenance/governance/{domain}/org_{orgNorm}/violations
 *
 * where {orgNorm} is the org UUID with hyphens stripped.
 */
@Injectable()
export class RegoCompiler {
  /**
   * Compile governance rules JSON to a full Rego module text.
   *
   * @param orgId        - Organisation UUID
   * @param policyDomain - Policy domain (determines Rego package + violation detail labels)
   * @param rules        - The rules payload from policy_versions.rules
   */
  compile(
    orgId: string,
    policyDomain: PolicyDomain,
    rules: Record<string, unknown>,
  ): string {
    const orgNorm = RegoCompiler.normaliseOrgId(orgId);
    const packageName = `provenance.governance.${policyDomain}.org_${orgNorm}`;
    const ruleList = (rules as unknown as GovernanceRulesPayload).rules ?? [];

    const violationClauses = ruleList
      .map((rule) => this.compileRule(rule, policyDomain))
      .filter((clause): clause is string => clause !== null)
      .join('\n\n');

    const body = violationClauses.length > 0
      ? violationClauses
      : this.emptyViolations(policyDomain);

    return [
      `package ${packageName}`,
      '',
      'import rego.v1',
      '',
      body,
    ].join('\n');
  }

  // ---------------------------------------------------------------------------
  // Static path helpers — used by the service to construct OPA calls
  // ---------------------------------------------------------------------------

  /** OPA policy ID used in PUT /v1/policies/{id}. */
  static policyId(orgId: string, policyDomain: PolicyDomain): string {
    return `provenance_governance_${policyDomain}_org_${RegoCompiler.normaliseOrgId(orgId)}`;
  }

  /**
   * OPA data path for querying the violations set.
   * Used in POST /v1/data/{path}.
   */
  static violationsPath(orgId: string, policyDomain: PolicyDomain): string {
    return `provenance/governance/${policyDomain}/org_${RegoCompiler.normaliseOrgId(orgId)}/violations`;
  }

  // ---------------------------------------------------------------------------
  // Private rule compilers
  // ---------------------------------------------------------------------------

  private compileRule(rule: GovernanceRule, policyDomain: PolicyDomain): string | null {
    switch (rule.type) {
      case 'require_port_type':
        return this.compileRequirePortType(rule as RequirePortTypeRule, policyDomain);
      case 'require_field_non_empty':
        return this.compileRequireFieldNonEmpty(rule as RequireFieldNonEmptyRule, policyDomain);
      case 'require_classification_level':
        return this.compileRequireClassificationLevel(rule as RequireClassificationLevelRule, policyDomain);
      default:
        // Unknown rule types are silently skipped for forward compatibility.
        return null;
    }
  }

  private compileRequirePortType(
    rule: RequirePortTypeRule,
    policyDomain: PolicyDomain,
  ): string {
    const { id, config } = rule;
    const { portType, minCount } = config;
    return [
      `violations contains violation if {`,
      `    # Rule: ${id}`,
      `    count([p | p := input.product.ports[_]; p.portType == "${portType}"]) < ${minCount}`,
      `    violation := {"rule_id": "${id}", "detail": "Product must have at least ${minCount} ${portType} port(s)", "policyDomain": "${policyDomain}"}`,
      `}`,
    ].join('\n');
  }

  private compileRequireFieldNonEmpty(
    rule: RequireFieldNonEmptyRule,
    policyDomain: PolicyDomain,
  ): string {
    const { id, config } = rule;
    const { field } = config;
    return [
      `violations contains violation if {`,
      `    # Rule: ${id}`,
      `    not input.product.${field}`,
      `    violation := {"rule_id": "${id}", "detail": "Product field '${field}' must not be empty", "policyDomain": "${policyDomain}"}`,
      `}`,
    ].join('\n');
  }

  private compileRequireClassificationLevel(
    rule: RequireClassificationLevelRule,
    policyDomain: PolicyDomain,
  ): string {
    const { id, config } = rule;
    const { allowedValues } = config;
    const allowedSet = `{${allowedValues.map((v) => `"${v}"`).join(', ')}}`;
    return [
      `violations contains violation if {`,
      `    # Rule: ${id}`,
      `    not input.product.classification in ${allowedSet}`,
      `    violation := {"rule_id": "${id}", "detail": "Product classification must be one of: ${allowedValues.join(', ')}", "policyDomain": "${policyDomain}"}`,
      `}`,
    ].join('\n');
  }

  private emptyViolations(policyDomain: PolicyDomain): string {
    return [
      `# No rules defined — policy domain '${policyDomain}' has no constraints.`,
      `# Empty set: the partial rule below never fires, so violations is always empty.`,
      `violations contains v if {`,
      `    v := {"rule_id": "unreachable", "detail": "unreachable", "policyDomain": "${policyDomain}"}`,
      `    false`,
      `}`,
    ].join('\n');
  }

  private static normaliseOrgId(orgId: string): string {
    return orgId.replace(/-/g, '');
  }
}
