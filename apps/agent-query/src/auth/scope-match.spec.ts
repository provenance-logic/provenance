// Env required by control-plane.client → config import chain. Loaded
// here only because the surrounding module graph reaches config at
// import time; the match function itself has no env dependency.
process.env['PORT'] = '3002';
process.env['CONTROL_PLANE_URL'] = 'http://localhost:3001';
process.env['MCP_API_KEY'] = 'test-mcp-key';
process.env['DEFAULT_ORG_ID'] = '00000000-0000-0000-0000-000000000001';
process.env['KEYCLOAK_URL'] = 'http://localhost:8080';
process.env['KEYCLOAK_REALM'] = 'provenance';

import { matchesScope } from './scope-match.js';

describe('matchesScope (F12.16 / ADR-006 subset check)', () => {
  describe('null / empty approved scope', () => {
    it('denies any action when approved scope is null', () => {
      const result = matchesScope(null, {});
      expect(result.matches).toBe(false);
    });
  });

  describe('port dimension', () => {
    it('allows an action with no port specified regardless of declared ports', () => {
      const result = matchesScope({ ports: ['p1'] }, {});
      expect(result.matches).toBe(true);
    });

    it('allows when the requested port is in the declared port set', () => {
      const result = matchesScope({ ports: ['p1', 'p2'] }, { port: 'p1' });
      expect(result.matches).toBe(true);
    });

    it('denies when the requested port is not in the declared port set', () => {
      const result = matchesScope({ ports: ['p1'] }, { port: 'p2' });
      expect(result.matches).toBe(false);
      if (!result.matches) {
        expect(result.reason).toContain('not in approved ports');
      }
    });

    it('denies when the approved scope declares no ports at all but the action targets one', () => {
      const result = matchesScope({ data_categories: ['c1'] }, { port: 'p1' });
      expect(result.matches).toBe(false);
    });

    it('denies when the approved ports array is empty', () => {
      const result = matchesScope({ ports: [] }, { port: 'p1' });
      expect(result.matches).toBe(false);
    });

    it('treats a non-string-array ports value as no declared ports', () => {
      const result = matchesScope({ ports: 'not-an-array' }, { port: 'p1' });
      expect(result.matches).toBe(false);
    });
  });

  describe('data_categories dimension', () => {
    it('allows when requested categories are a subset of approved categories', () => {
      const result = matchesScope(
        { data_categories: ['pii', 'finance', 'product'] },
        { dataCategories: ['pii', 'product'] },
      );
      expect(result.matches).toBe(true);
    });

    it('denies when any requested category is outside the approved set', () => {
      const result = matchesScope(
        { data_categories: ['pii'] },
        { dataCategories: ['pii', 'finance'] },
      );
      expect(result.matches).toBe(false);
      if (!result.matches) {
        expect(result.reason).toContain('finance');
      }
    });

    it('allows when the approval declares no data_categories at all (implicit "all")', () => {
      const result = matchesScope(
        { ports: ['p1'] },
        { dataCategories: ['pii'] },
      );
      expect(result.matches).toBe(true);
    });

    it('allows when the action declares no data_categories regardless of approval', () => {
      const result = matchesScope({ data_categories: ['pii'] }, {});
      expect(result.matches).toBe(true);
    });
  });

  describe('combined dimensions', () => {
    it('requires every declared dimension to match', () => {
      const approved = { ports: ['p1'], data_categories: ['pii'] };
      // port mismatch: deny even though categories match
      const r1 = matchesScope(approved, { port: 'p2', dataCategories: ['pii'] });
      expect(r1.matches).toBe(false);
      // category overrun: deny even though port matches
      const r2 = matchesScope(approved, { port: 'p1', dataCategories: ['pii', 'finance'] });
      expect(r2.matches).toBe(false);
      // both match: allow
      const r3 = matchesScope(approved, { port: 'p1', dataCategories: ['pii'] });
      expect(r3.matches).toBe(true);
    });
  });
});
