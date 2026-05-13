import { z } from 'zod';
import type {
  ConnectionReferenceScope,
  DataCategoryConstraints,
} from '@provenance/types';

// ---------------------------------------------------------------------------
// Domain 12 scope payload Zod schemas.
//
// MVP shape locked 2026-05-08 (see documents/architecture/plans/
// domain-12-runtime-enforcement.md Decision 1 and ADR-006 amendment
// dated 2026-05-13). These schemas are the runtime enforcement of the
// types in `packages/types/src/consent.ts` — they reject any payload
// that does not match the locked shape so that the F12.16 scope
// matcher can later assume the cached shape is well-formed.
// ---------------------------------------------------------------------------

/**
 * `ports` lists output port names. The wildcard `'*'` is allowed and
 * stands for "all output ports of the product". Names rather than
 * UUIDs because F12.6 requires the use-case declaration to be
 * preserved verbatim; the cache resolves names to current ports at
 * runtime.
 */
export const connectionReferenceScopeSchema = z
  .object({
    ports: z.array(z.string().min(1)).min(1),
  })
  .strict();

/**
 * `allowed_categories` is optional — absent means no category-level
 * narrowing beyond the port list. When present, it must be a non-empty
 * list of category names.
 */
export const dataCategoryConstraintsSchema = z
  .object({
    allowed_categories: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();

/**
 * Parse and validate a connection-reference scope payload. Throws
 * a ZodError on failure; callers convert that to a 400.
 */
export function parseConnectionReferenceScope(
  value: unknown,
): ConnectionReferenceScope {
  return connectionReferenceScopeSchema.parse(value);
}

/**
 * Parse and validate an optional data-category-constraints payload.
 * `undefined` and `null` are returned as-is (the field is optional on
 * both the request and the row); any other value is parsed. Returning
 * the shared type means callers can store the result directly on the
 * entity without re-narrowing — the `allowed_categories` field is
 * preserved as-given (absent vs. present) by Zod's strict mode.
 */
export function parseDataCategoryConstraints(
  value: unknown,
): DataCategoryConstraints | null {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = dataCategoryConstraintsSchema.parse(value);
  return parsed.allowed_categories === undefined
    ? {}
    : { allowed_categories: parsed.allowed_categories };
}
