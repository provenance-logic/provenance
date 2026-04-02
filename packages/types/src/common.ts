/**
 * Shared primitive types used across the MeshOS platform.
 * These mirror the OpenAPI schema primitives in packages/openapi/.
 */

export type Uuid = string;
export type IsoTimestamp = string;
export type SemanticVersion = string;
export type Slug = string;

export interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
}

export interface PaginatedList<T> {
  items: T[];
  meta: PaginationMeta;
}

export interface ErrorResponse {
  statusCode: number;
  error: string;
  message: string;
  details?: Record<string, unknown>[];
}
