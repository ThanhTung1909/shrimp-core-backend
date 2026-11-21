-- AQS-104 durable inbox. Run manually with psql; app startup never runs migrations.
BEGIN;

CREATE TABLE IF NOT EXISTS ai_risk_alert_receipt (
  receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  outcome varchar(20) NOT NULL CHECK (outcome IN ('CREATED', 'IGNORED_LOW')),
  alert_id uuid NULL REFERENCES alert(alert_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ai_risk_alert_receipt_event_id UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_risk_alert_receipt_alert_id ON ai_risk_alert_receipt(alert_id);

COMMIT;
