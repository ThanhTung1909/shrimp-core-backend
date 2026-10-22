-- P1-3 Farms & Crops. Run manually against the intended PostgreSQL database:
-- psql --set ON_ERROR_STOP=1 --dbname <database-name> -f database/migrations/20261020_p13_farms_crops.sql
-- Safe for existing ponds: farm_id is deliberately nullable. Backfill only after
-- business owners map legacy ponds to farms; no existing ownership is inferred.
BEGIN;

CREATE TABLE IF NOT EXISTS public.farms (
  farm_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_name varchar(150) NOT NULL,
  owner_id uuid NOT NULL REFERENCES public.users(user_id) ON DELETE RESTRICT,
  address varchar(500),
  total_area numeric(14,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT farms_total_area_positive CHECK (total_area IS NULL OR total_area > 0)
);
CREATE INDEX IF NOT EXISTS idx_farms_owner_id ON public.farms(owner_id);

ALTER TABLE public.pond ADD COLUMN IF NOT EXISTS farm_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pond_farm_id_fkey') THEN
    ALTER TABLE public.pond ADD CONSTRAINT pond_farm_id_fkey FOREIGN KEY (farm_id) REFERENCES public.farms(farm_id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pond_farm_id ON public.pond(farm_id);

DO $$ BEGIN
  CREATE TYPE public.shrimpbatchstatus AS ENUM ('ACTIVE', 'HARVESTED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS public.shrimp_batches (
  batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pond_id uuid NOT NULL REFERENCES public.pond(pond_id) ON DELETE RESTRICT,
  stocking_date date NOT NULL,
  initial_quantity bigint NOT NULL CHECK (initial_quantity > 0),
  shrimp_species varchar(100) NOT NULL,
  expected_harvest_date date,
  status public.shrimpbatchstatus NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shrimp_batches_expected_date CHECK (expected_harvest_date IS NULL OR expected_harvest_date >= stocking_date)
);
CREATE INDEX IF NOT EXISTS idx_shrimp_batches_pond_id ON public.shrimp_batches(pond_id);
CREATE INDEX IF NOT EXISTS idx_shrimp_batches_status ON public.shrimp_batches(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_batch_per_pond ON public.shrimp_batches(pond_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS public.harvest_logs (
  harvest_log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.shrimp_batches(batch_id) ON DELETE RESTRICT,
  harvest_date date NOT NULL,
  harvest_quantity bigint CHECK (harvest_quantity IS NULL OR harvest_quantity > 0),
  harvest_weight_kg numeric(14,3) NOT NULL CHECK (harvest_weight_kg > 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_harvest_logs_batch_id ON public.harvest_logs(batch_id);
COMMIT;

-- Post-run checks (read-only):
-- SELECT farm_id FROM public.pond WHERE farm_id IS NULL; -- legacy ponds awaiting an explicit map
-- SELECT pond_id, count(*) FROM public.shrimp_batches WHERE status='ACTIVE' GROUP BY pond_id HAVING count(*) > 1; -- must return zero rows
