import { ZodError } from 'zod';
import {
  parseConnectionReferenceScope,
  parseDataCategoryConstraints,
} from '../scope.schemas.js';

describe('connectionReferenceScopeSchema', () => {
  it('accepts a single named port', () => {
    expect(parseConnectionReferenceScope({ ports: ['output-1'] })).toEqual({
      ports: ['output-1'],
    });
  });

  it('accepts multiple named ports', () => {
    const value = { ports: ['output-1', 'observability', 'discovery'] };
    expect(parseConnectionReferenceScope(value)).toEqual(value);
  });

  it("accepts the wildcard '*' meaning all output ports", () => {
    expect(parseConnectionReferenceScope({ ports: ['*'] })).toEqual({
      ports: ['*'],
    });
  });

  it('rejects an empty ports list — at least one port must be consented to', () => {
    expect(() => parseConnectionReferenceScope({ ports: [] })).toThrow(ZodError);
  });

  it('rejects an empty-string port name', () => {
    expect(() => parseConnectionReferenceScope({ ports: [''] })).toThrow(ZodError);
  });

  it('rejects a missing ports field', () => {
    expect(() => parseConnectionReferenceScope({})).toThrow(ZodError);
  });

  it('rejects unknown keys — the locked shape has no other fields', () => {
    expect(() =>
      parseConnectionReferenceScope({ ports: ['output-1'], fields: ['x'] }),
    ).toThrow(ZodError);
  });

  it('rejects null', () => {
    expect(() => parseConnectionReferenceScope(null)).toThrow(ZodError);
  });

  it('rejects a non-object value', () => {
    expect(() => parseConnectionReferenceScope('output-1')).toThrow(ZodError);
  });
});

describe('dataCategoryConstraintsSchema', () => {
  it('treats undefined as null — the field is optional on the request', () => {
    expect(parseDataCategoryConstraints(undefined)).toBeNull();
  });

  it('treats null as null — entities store null when there are no constraints', () => {
    expect(parseDataCategoryConstraints(null)).toBeNull();
  });

  it('accepts an empty object — no narrowing beyond the port list', () => {
    expect(parseDataCategoryConstraints({})).toEqual({});
  });

  it('accepts allowed_categories with one entry', () => {
    expect(parseDataCategoryConstraints({ allowed_categories: ['pii'] })).toEqual({
      allowed_categories: ['pii'],
    });
  });

  it('accepts allowed_categories with multiple entries', () => {
    const value = { allowed_categories: ['pii', 'financial', 'health'] };
    expect(parseDataCategoryConstraints(value)).toEqual(value);
  });

  it('rejects an empty allowed_categories list — undefined would be the correct way to say "no narrowing"', () => {
    expect(() => parseDataCategoryConstraints({ allowed_categories: [] })).toThrow(ZodError);
  });

  it('rejects an empty-string category', () => {
    expect(() => parseDataCategoryConstraints({ allowed_categories: [''] })).toThrow(ZodError);
  });

  it('rejects unknown keys', () => {
    expect(() =>
      parseDataCategoryConstraints({ allowed_categories: ['pii'], extras: 'no' }),
    ).toThrow(ZodError);
  });
});
