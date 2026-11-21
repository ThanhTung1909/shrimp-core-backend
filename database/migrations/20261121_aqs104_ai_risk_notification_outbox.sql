-- AQS-104 durable notification intent for AI-risk alerts. Additive and rerunnable.
BEGIN;

CREATE TABLE IF NOT EXISTS ai_risk_notification_outbox (
  outbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NULL,
  last_error varchar(500) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ai_risk_notification_outbox_status CHECK (status IN ('PENDING', 'PROCESSING', 'DISPATCHED')),
  CONSTRAINT uq_ai_risk_notification_outbox_alert_id UNIQUE (alert_id),
  CONSTRAINT fk_ai_risk_notification_outbox_alert FOREIGN KEY (alert_id) REFERENCES alert(alert_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_risk_notification_outbox_ready
  ON ai_risk_notification_outbox(status, next_attempt_at);

COMMIT;
