BEGIN;

ALTER TABLE public.device
    ALTER COLUMN pond_id DROP NOT NULL;

ALTER TABLE public.device
    DROP CONSTRAINT IF EXISTS device_pond_id_fkey;

ALTER TABLE public.device
    ADD CONSTRAINT device_pond_id_fkey
    FOREIGN KEY (pond_id)
    REFERENCES public.pond(pond_id)
    ON DELETE SET NULL;

COMMIT;
