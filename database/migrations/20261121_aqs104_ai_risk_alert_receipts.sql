-- AQS-104 durable inbox. Run manually with psql; app startup never runs migrations.
-- This migration is additive and deliberately supports a table created earlier
-- by TypeORM synchronize during the isolated E2E setup.
BEGIN;

CREATE TABLE IF NOT EXISTS ai_risk_alert_receipt (
  receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  outcome varchar(20) NOT NULL,
  alert_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ai_risk_alert_receipt_outcome CHECK (outcome IN ('CREATED', 'IGNORED_LOW')),
  CONSTRAINT uq_ai_risk_alert_receipt_event_id UNIQUE (event_id),
  CONSTRAINT fk_ai_risk_alert_receipt_alert FOREIGN KEY (alert_id) REFERENCES alert(alert_id) ON DELETE SET NULL
);

-- Existing rows are verified before adding the CHECK. Do not repair or delete
-- data here: an invalid pre-existing row must stop the migration visibly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'ai_risk_alert_receipt'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%outcome%'
      AND pg_get_constraintdef(oid) LIKE '%CREATED%'
      AND pg_get_constraintdef(oid) LIKE '%IGNORED_LOW%'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM ai_risk_alert_receipt
      WHERE outcome IS NULL OR outcome NOT IN ('CREATED', 'IGNORED_LOW')
    ) THEN
      RAISE EXCEPTION 'Cannot add AI-risk receipt outcome check: invalid existing data';
    END IF;
    ALTER TABLE ai_risk_alert_receipt
      ADD CONSTRAINT chk_ai_risk_alert_receipt_outcome
      CHECK (outcome IN ('CREATED', 'IGNORED_LOW'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_risk_alert_receipt_event_id
  ON ai_risk_alert_receipt(event_id);
CREATE INDEX IF NOT EXISTS idx_ai_risk_alert_receipt_alert_id
  ON ai_risk_alert_receipt(alert_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN unnest(c.conkey) AS key(attnum) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = key.attnum
    WHERE c.conrelid = 'ai_risk_alert_receipt'::regclass
      AND c.contype = 'f'
      AND c.confrelid = 'alert'::regclass
      AND a.attname = 'alert_id'
  ) THEN
    ALTER TABLE ai_risk_alert_receipt
      ADD CONSTRAINT fk_ai_risk_alert_receipt_alert
      FOREIGN KEY (alert_id) REFERENCES alert(alert_id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
