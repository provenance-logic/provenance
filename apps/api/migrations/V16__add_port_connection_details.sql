-- Migration V16: Port connection details (Domain 10 Workstream B — F10.5 / F10.6)
--
-- Adds encrypted-at-rest connection details to products.port_declarations so that
-- every output port carries the concrete connection information a data engineer
-- (human or agent) needs to actually use the port. Full disclosure is gated by
-- active access grant (F10.6) — redaction/access logic lives in the application
-- layer; this migration defines the storage.
--
-- Columns:
--   connection_details            — JSONB, nullable. Structure depends on the
--                                   port's interface_type. Stored as the JSON
--                                   envelope emitted by EncryptionService
--                                   ({ version, iv, authTag, ciphertext }) when
--                                   connection_details_encrypted = true.
--   connection_details_validated  — whether platform-side connectivity check
--                                   has succeeded (F10.7, Phase B4 stub).
--   connection_details_encrypted  — whether stored JSON is an encrypted
--                                   envelope. Enables safe rollout of the
--                                   encryption service without a hard cutover.

ALTER TABLE products.port_declarations
    ADD COLUMN connection_details            JSONB,
    ADD COLUMN connection_details_validated  BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN connection_details_encrypted  BOOLEAN NOT NULL DEFAULT false;
