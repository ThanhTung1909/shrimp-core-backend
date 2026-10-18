-- ============================================================================
-- P0-3/P0-4 TRANSITION MIGRATION: make users."isLocked" the sole lock contract
-- ============================================================================
-- This migration deliberately retains legacy columns. It is safe to rerun:
-- existing true values in either lock column can only result in true.
-- Run manually against the intended PostgreSQL database; not auto-run by Nest.
--
-- Apply command:
--   psql --set ON_ERROR_STOP=1 --dbname <database-name> \
--        -f database/migrations/20261010_p03_transition_to_islocked.sql
--
-- PRE-MIGRATION VERIFICATION:
--   First inspect the lock columns; do not query "isLocked" on a legacy
--   database until this query confirms that the column exists:
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'users'
--     AND column_name IN ('isLocked', 'is_login_locked', 'lock_reason', 'locked_at', 'locked_by')
--   ORDER BY column_name;
--
--   If "isLocked" exists, record its locked user IDs/count. If
--   is_login_locked exists, record its locked user IDs/count. The post-run
--   "isLocked" set must equal the union of those two pre-run sets.
--
-- POST-MIGRATION VERIFICATION:
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'isLocked';
--   -- Must show: isLocked | boolean | NO | false (PostgreSQL may render the
--   -- default as false, false::boolean, or a cast-equivalent expression).
--
--   SELECT COUNT(*) AS users_total,
--          COUNT(*) FILTER (WHERE "isLocked") AS locked_after
--   FROM public.users;
--   -- locked_after must equal the pre-run union of current and legacy locks.
--   -- The legacy columns may still appear in information_schema: they are
--   -- intentionally retained for old-database compatibility, but are not part
--   -- of the application's lock contract after cutover.
--
-- ROLLBACK & SAFETY NOTES:
--   1. The script runs in a single transaction (BEGIN ... COMMIT). Any schema or
--      data failure triggers automatic transaction rollback.
--   2. Legacy columns (is_login_locked, lock_reason, locked_at, locked_by) are
--      intentionally retained to prevent breaking legacy queries and enable audit.
--   3. After application cutover, new locks are written to "isLocked". Do not run
--      mixed-version binaries writing to is_login_locked concurrently.
-- ============================================================================
BEGIN;

DO $$
DECLARE
  has_current_column boolean;
  has_legacy_column boolean;
  current_type text;
  legacy_type text;
  case_conflict text;
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION
      'P0 isLocked transition aborted: expected table public.users does not exist';
  END IF;

  -- A differently cased spelling is a different PostgreSQL identifier.  Do not
  -- guess whether it holds security state; require an operator to resolve it.
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY column_name)
    INTO case_conflict
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'users'
     AND lower(column_name) = 'islocked'
     AND column_name <> 'isLocked';

  IF case_conflict IS NOT NULL THEN
    RAISE EXCEPTION
      'P0 isLocked transition aborted: ambiguous lock column(s) found: %',
      case_conflict;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name = 'isLocked'
  ) INTO has_current_column;

  SELECT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name = 'is_login_locked'
  ) INTO has_legacy_column;

  IF has_current_column THEN
    SELECT data_type
      INTO current_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name = 'isLocked';

    IF current_type <> 'boolean' THEN
      RAISE EXCEPTION
        'P0 isLocked transition aborted: public.users."isLocked" must be boolean, found %',
        current_type;
    END IF;
  ELSE
    ALTER TABLE public.users ADD COLUMN "isLocked" boolean;
  END IF;

  IF has_legacy_column THEN
    SELECT data_type
      INTO legacy_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name = 'is_login_locked';

    IF legacy_type <> 'boolean' THEN
      RAISE EXCEPTION
        'P0 isLocked transition aborted: public.users.is_login_locked must be boolean, found %',
        legacy_type;
    END IF;

    -- Truth-preserving merge: a lock recorded by either representation wins.
    UPDATE public.users
       SET "isLocked" = COALESCE("isLocked", false)
                      OR COALESCE(is_login_locked, false);
  ELSE
    -- Existing NULL values are not durable locks; normalize before NOT NULL.
    UPDATE public.users
       SET "isLocked" = COALESCE("isLocked", false);
  END IF;

  ALTER TABLE public.users
    ALTER COLUMN "isLocked" SET DEFAULT false,
    ALTER COLUMN "isLocked" SET NOT NULL;
END $$;

COMMIT;
