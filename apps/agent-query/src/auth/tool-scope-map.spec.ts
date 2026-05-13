import { lookupToolScope, EXEMPT_TOOLS } from './tool-scope-map.js';

describe('lookupToolScope — exempt tools', () => {
  it.each([
    'list_products',
    'search_products',
    'semantic_search',
    'register_agent',
    'get_agent_status',
  ])('treats %s as exempt', (toolName) => {
    expect(lookupToolScope(toolName)).toEqual({
      exempt: true,
      unknown: false,
    });
  });

  it('EXEMPT_TOOLS contains exactly the five tools declared by Decision 4', () => {
    expect(EXEMPT_TOOLS.size).toBe(5);
    expect([...EXEMPT_TOOLS].sort()).toEqual(
      [
        'get_agent_status',
        'list_products',
        'register_agent',
        'search_products',
        'semantic_search',
      ].sort(),
    );
  });
});

describe('lookupToolScope — product-bound tools', () => {
  it('maps get_product to the discovery port', () => {
    expect(lookupToolScope('get_product')).toEqual({
      exempt: false,
      actionScope: { port: 'discovery' },
      unknown: false,
    });
  });

  it('maps get_lineage to the discovery port', () => {
    expect(lookupToolScope('get_lineage')).toEqual({
      exempt: false,
      actionScope: { port: 'discovery' },
      unknown: false,
    });
  });

  it('maps get_trust_score to the observability port', () => {
    expect(lookupToolScope('get_trust_score')).toEqual({
      exempt: false,
      actionScope: { port: 'observability' },
      unknown: false,
    });
  });

  it('maps get_slo_summary to the observability port', () => {
    expect(lookupToolScope('get_slo_summary')).toEqual({
      exempt: false,
      actionScope: { port: 'observability' },
      unknown: false,
    });
  });
});

describe('lookupToolScope — safety belt for unknown tools', () => {
  it("reports unknown for a tool that is not in the map (so the guard denies by default)", () => {
    expect(lookupToolScope('mystery_tool')).toEqual({
      exempt: false,
      unknown: true,
    });
  });

  it('reports unknown for the empty string', () => {
    expect(lookupToolScope('')).toEqual({
      exempt: false,
      unknown: true,
    });
  });

  it('treats casing strictly — list_Products (capitalized P) is unknown', () => {
    // MCP tool names are lower_snake_case; nothing in the map should
    // match a different casing, since silent normalization could mask
    // an outright typo in a new tool.
    expect(lookupToolScope('list_Products')).toEqual({
      exempt: false,
      unknown: true,
    });
  });
});
