-- P1-3 manager/farmer pond assignments. Run manually against the intended DB.
-- This adds a table only; it does not alter or delete existing Farm, Pond, Crop,
-- Device, or HarvestLog rows.
BEGIN;

CREATE TABLE IF NOT EXISTS public.pond_farmer_assignments (
  assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pond_id uuid NOT NULL REFERENCES public.pond(pond_id) ON DELETE CASCADE,
  farmer_id uuid NOT NULL REFERENCES public.users(user_id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pond_farmer_assignments_pond_farmer UNIQUE (pond_id, farmer_id)
);

CREATE INDEX IF NOT EXISTS idx_pond_farmer_assignments_farmer_id
  ON public.pond_farmer_assignments(farmer_id);

COMMIT;
