-- P1-2: one FCM token may have only one owner at a time.
-- Run manually only against the intended database after resolving any listed
-- historical duplicates. Do not run this migration automatically.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM notification_token GROUP BY token HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot add global FCM token ownership constraint: duplicate notification_token.token rows exist';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'notification_token'::regclass
      AND conname = 'uq_notification_token_token'
  ) THEN
    ALTER TABLE notification_token
      ADD CONSTRAINT uq_notification_token_token UNIQUE (token);
  END IF;
END $$;

-- Rollback: ALTER TABLE notification_token DROP CONSTRAINT IF EXISTS uq_notification_token_token;
COMMIT;
