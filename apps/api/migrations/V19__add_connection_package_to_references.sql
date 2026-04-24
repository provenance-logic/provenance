-- Migration V19: Connection package on connection references (ADR-008, F12.13)
--
-- Adds a JSONB column holding the ready-to-use connection artifact generated
-- at activation time. Per ADR-008 the package is issued per connection
-- reference (not per access grant), its lifecycle tracks the reference, and
-- it is retained as an immutable audit artifact even after the reference
-- terminates — callers interpret the reference's `state` to decide whether
-- the package is usable.
--
-- Nullable because:
--   * pending references have not yet been approved and carry no package
--   * legacy references created before this migration have no package
--
-- The payload is the same ConnectionPackage shape stored on access_grants
-- (connection_package column, V17) so the existing types and consumers
-- can read it without a new schema.
--
-- Note: per-reference scope filtering (ADR-008 "Scope Inheritance" — the
-- package reflects only the approved ports/fields) lands in a follow-up
-- slice. This migration and the accompanying service integration store
-- the full product package; the narrowing pass comes next.

ALTER TABLE consent.connection_references
    ADD COLUMN connection_package JSONB;
