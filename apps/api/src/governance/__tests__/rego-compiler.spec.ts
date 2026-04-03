import { RegoCompiler } from '../compilation/rego-compiler.js';

describe('RegoCompiler', () => {
  let compiler: RegoCompiler;

  beforeEach(() => {
    compiler = new RegoCompiler();
  });

  // ---------------------------------------------------------------------------
  // Static path helpers
  // ---------------------------------------------------------------------------

  describe('policyId()', () => {
    it('strips hyphens from org UUID and builds the OPA policy ID', () => {
      const id = RegoCompiler.policyId('org-123-abc', 'product_schema');
      expect(id).toBe('provenance_governance_product_schema_org_org123abc');
    });
  });

  describe('violationsPath()', () => {
    it('returns the OPA data path for querying violations', () => {
      const path = RegoCompiler.violationsPath('org-123-abc', 'product_schema');
      expect(path).toBe('provenance/governance/product_schema/org_org123abc/violations');
    });
  });

  // ---------------------------------------------------------------------------
  // Package declaration
  // ---------------------------------------------------------------------------

  describe('compile() — package name', () => {
    it('generates the correct package for the given org and domain', () => {
      const rego = compiler.compile('abc-def-123', 'product_schema', { rules: [] });
      expect(rego).toContain('package provenance.governance.product_schema.org_abcdef123');
    });

    it('imports future.keywords.in for the "in" keyword', () => {
      const rego = compiler.compile('abc', 'product_schema', { rules: [] });
      expect(rego).toContain('import future.keywords.in');
    });
  });

  // ---------------------------------------------------------------------------
  // Empty rules
  // ---------------------------------------------------------------------------

  describe('compile() — empty rules', () => {
    it('emits a default violations := set() when rules array is empty', () => {
      const rego = compiler.compile('org-1', 'product_schema', { rules: [] });
      expect(rego).toContain('violations := set()');
    });

    it('emits default violations when rules key is absent', () => {
      const rego = compiler.compile('org-1', 'product_schema', {});
      expect(rego).toContain('violations := set()');
    });
  });

  // ---------------------------------------------------------------------------
  // require_port_type rule
  // ---------------------------------------------------------------------------

  describe('compile() — require_port_type', () => {
    const rules = {
      rules: [
        {
          id: 'require_output_port',
          type: 'require_port_type',
          config: { portType: 'output', minCount: 1 },
        },
      ],
    };

    it('generates a violations contains block', () => {
      const rego = compiler.compile('org-1', 'product_schema', rules);
      expect(rego).toContain('violations contains violation if {');
    });

    it('generates a port count check for the specified portType and minCount', () => {
      const rego = compiler.compile('org-1', 'product_schema', rules);
      expect(rego).toContain('p.portType == "output"');
      expect(rego).toContain('< 1');
    });

    it('includes the rule_id and policyDomain in the violation object', () => {
      const rego = compiler.compile('org-1', 'product_schema', rules);
      expect(rego).toContain('"rule_id": "require_output_port"');
      expect(rego).toContain('"policyDomain": "product_schema"');
    });

    it('embeds the detail message with minCount in plain English', () => {
      const rego = compiler.compile('org-1', 'product_schema', rules);
      expect(rego).toContain('Product must have at least 1 output port(s)');
    });
  });

  // ---------------------------------------------------------------------------
  // require_field_non_empty rule
  // ---------------------------------------------------------------------------

  describe('compile() — require_field_non_empty', () => {
    const rules = {
      rules: [
        {
          id: 'require_description',
          type: 'require_field_non_empty',
          config: { field: 'description' },
        },
      ],
    };

    it('generates a not input.product.{field} check', () => {
      const rego = compiler.compile('org-1', 'product_schema', rules);
      expect(rego).toContain('not input.product.description');
    });

    it('includes the rule_id in the violation object', () => {
      const rego = compiler.compile('org-1', 'product_schema', rules);
      expect(rego).toContain('"rule_id": "require_description"');
    });

    it('includes the field name in the detail message', () => {
      const rego = compiler.compile('org-1', 'product_schema', rules);
      expect(rego).toContain("Product field 'description' must not be empty");
    });
  });

  // ---------------------------------------------------------------------------
  // require_classification_level rule
  // ---------------------------------------------------------------------------

  describe('compile() — require_classification_level', () => {
    const rules = {
      rules: [
        {
          id: 'require_non_public',
          type: 'require_classification_level',
          config: { allowedValues: ['internal', 'confidential', 'restricted'] },
        },
      ],
    };

    it('generates a not ... in {...} classification check', () => {
      const rego = compiler.compile('org-1', 'product_schema', rules);
      expect(rego).toContain('not input.product.classification in');
      expect(rego).toContain('"internal"');
      expect(rego).toContain('"confidential"');
      expect(rego).toContain('"restricted"');
    });

    it('lists the allowed values in the detail message', () => {
      const rego = compiler.compile('org-1', 'product_schema', rules);
      expect(rego).toContain('internal, confidential, restricted');
    });
  });

  // ---------------------------------------------------------------------------
  // Multiple rules
  // ---------------------------------------------------------------------------

  describe('compile() — multiple rules', () => {
    const rules = {
      rules: [
        {
          id: 'require_output_port',
          type: 'require_port_type',
          config: { portType: 'output', minCount: 1 },
        },
        {
          id: 'require_description',
          type: 'require_field_non_empty',
          config: { field: 'description' },
        },
      ],
    };

    it('compiles all rules into the same Rego module', () => {
      const rego = compiler.compile('org-1', 'product_schema', rules);
      expect(rego).toContain('"rule_id": "require_output_port"');
      expect(rego).toContain('"rule_id": "require_description"');
    });

    it('does NOT emit violations := set() when rules are present', () => {
      const rego = compiler.compile('org-1', 'product_schema', rules);
      expect(rego).not.toContain('violations := set()');
    });
  });

  // ---------------------------------------------------------------------------
  // Unknown rule types
  // ---------------------------------------------------------------------------

  describe('compile() — unknown rule type', () => {
    it('skips unknown rule types without throwing', () => {
      const rules = {
        rules: [
          { id: 'future_rule', type: 'some_future_rule_type', config: {} },
        ],
      };
      expect(() => compiler.compile('org-1', 'product_schema', rules)).not.toThrow();
    });

    it('emits violations := set() when all rules are of unknown type', () => {
      const rules = {
        rules: [
          { id: 'future_rule', type: 'some_future_rule_type', config: {} },
        ],
      };
      const rego = compiler.compile('org-1', 'product_schema', rules);
      expect(rego).toContain('violations := set()');
    });
  });

  // ---------------------------------------------------------------------------
  // Other policy domains
  // ---------------------------------------------------------------------------

  describe('compile() — non-product_schema domains', () => {
    it('embeds the correct policyDomain in violation objects for other domains', () => {
      const rules = {
        rules: [
          {
            id: 'require_description',
            type: 'require_field_non_empty',
            config: { field: 'description' },
          },
        ],
      };
      const rego = compiler.compile('org-1', 'access_control', rules);
      expect(rego).toContain('package provenance.governance.access_control');
      expect(rego).toContain('"policyDomain": "access_control"');
    });
  });
});
