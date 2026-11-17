-- AquaSense application-ACK idempotency ledger.
-- Run manually with psql; this migration is deliberately not executed by app startup.
BEGIN;

ALTER TABLE telemetry_data
  ADD COLUMN IF NOT EXISTS message_id varchar(64);

CREATE INDEX IF NOT EXISTS idx_telemetry_device_message
  ON telemetry_data (device_id, message_id);

CREATE TABLE IF NOT EXISTS telemetry_ingest_receipts (
  id bigserial PRIMARY KEY,
  device_id uuid NOT NULL,
  message_id varchar(64) NOT NULL,
  telemetry_id bigint NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_telemetry_ingest_receipt_device_message
    UNIQUE (device_id, message_id)
);

COMMIT;
