import { matchesApprovedScope } from './scope-match.js';

// ---------------------------------------------------------------------------
// Truth-table coverage for matchesApprovedScope. The plan calls for ≥95%
// branch coverage of this pure function; the cases below exercise every
// branch including the short-circuit ordering where port and category
// would both deny.
// ---------------------------------------------------------------------------

describe('matchesApprovedScope — port matching', () => {
  it('matches when the approved scope lists exactly the action port', () => {
    const result = matchesApprovedScope(
      { ports: ['discovery'] },
      null,
      { port: 'discovery' },
    );
    expect(result).toEqual({ ok: true });
  });

  it('matches when the approved scope is broader than the action (narrower action)', () => {
    const result = matchesApprovedScope(
      { ports: ['discovery', 'observability'] },
      null,
      { port: 'discovery' },
    );
    expect(result).toEqual({ ok: true });
  });

  it("denies when the approved scope does not include the action port (broader action)", () => {
    const result = matchesApprovedScope(
      { ports: ['discovery'] },
      null,
      { port: 'observability' },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'port_not_in_approved_scope',
    });
  });

  it("denies when the approved scope and action port are entirely disjoint", () => {
    const result = matchesApprovedScope(
      { ports: ['observability'] },
      null,
      { port: 'discovery' },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'port_not_in_approved_scope',
    });
  });

  it("treats the wildcard '*' as matching any action port", () => {
    expect(
      matchesApprovedScope({ ports: ['*'] }, null, { port: 'discovery' }),
    ).toEqual({ ok: true });
    expect(
      matchesApprovedScope({ ports: ['*'] }, null, { port: 'observability' }),
    ).toEqual({ ok: true });
    expect(
      matchesApprovedScope({ ports: ['*'] }, null, { port: 'events_v1' }),
    ).toEqual({ ok: true });
  });

  it("treats the wildcard alongside an explicit port as still matching anything", () => {
    const result = matchesApprovedScope(
      { ports: ['*', 'discovery'] },
      null,
      { port: 'observability' },
    );
    expect(result).toEqual({ ok: true });
  });
});

describe('matchesApprovedScope — data-category narrowing', () => {
  it('does not narrow when constraints are null', () => {
    const result = matchesApprovedScope(
      { ports: ['discovery'] },
      null,
      { port: 'discovery', dataCategories: ['pii'] },
    );
    expect(result).toEqual({ ok: true });
  });

  it('does not narrow when allowed_categories is absent', () => {
    const result = matchesApprovedScope(
      { ports: ['discovery'] },
      {},
      { port: 'discovery', dataCategories: ['pii'] },
    );
    expect(result).toEqual({ ok: true });
  });

  it('allows when the action categories are a strict subset of allowed_categories', () => {
    const result = matchesApprovedScope(
      { ports: ['discovery'] },
      { allowed_categories: ['pii', 'financial', 'health'] },
      { port: 'discovery', dataCategories: ['pii'] },
    );
    expect(result).toEqual({ ok: true });
  });

  it('allows when the action categories exactly match allowed_categories', () => {
    const result = matchesApprovedScope(
      { ports: ['discovery'] },
      { allowed_categories: ['pii', 'financial'] },
      { port: 'discovery', dataCategories: ['pii', 'financial'] },
    );
    expect(result).toEqual({ ok: true });
  });

  it('denies when the action declares a category not in allowed_categories', () => {
    const result = matchesApprovedScope(
      { ports: ['discovery'] },
      { allowed_categories: ['pii'] },
      { port: 'discovery', dataCategories: ['pii', 'financial'] },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'data_categories_not_in_approved_scope',
    });
  });

  it('allows when the action declares no categories at all, regardless of narrowing', () => {
    const result = matchesApprovedScope(
      { ports: ['discovery'] },
      { allowed_categories: ['pii'] },
      { port: 'discovery' },
    );
    expect(result).toEqual({ ok: true });
  });

  it('allows when the action declares an empty categories array', () => {
    const result = matchesApprovedScope(
      { ports: ['discovery'] },
      { allowed_categories: ['pii'] },
      { port: 'discovery', dataCategories: [] },
    );
    expect(result).toEqual({ ok: true });
  });
});

describe('matchesApprovedScope — denial short-circuit ordering', () => {
  it("reports port_not_in_approved_scope when both port AND categories would deny", () => {
    // Action wants port 'observability' (not in approved) AND category
    // 'financial' (not in allowed_categories). Port check runs first
    // and short-circuits, so the reason reported is the port reason.
    // The guard layer translates this reason into the audit-log entry
    // and the agent-facing denial code.
    const result = matchesApprovedScope(
      { ports: ['discovery'] },
      { allowed_categories: ['pii'] },
      { port: 'observability', dataCategories: ['financial'] },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'port_not_in_approved_scope',
    });
  });
});
