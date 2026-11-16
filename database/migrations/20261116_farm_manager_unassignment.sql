-- Allow an ADMIN to revoke a manager assignment without deleting the farm.
-- Run this migration before deploying the revoke-manager endpoint.
BEGIN;

ALTER TABLE farms
  ALTER COLUMN owner_id DROP NOT NULL;

COMMIT;
