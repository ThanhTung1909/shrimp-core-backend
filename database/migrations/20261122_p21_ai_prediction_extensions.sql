BEGIN;

ALTER TABLE public.ai_prediction
    ADD COLUMN IF NOT EXISTS prediction_type
    VARCHAR(30) NOT NULL DEFAULT 'WATER_QUALITY';

ALTER TABLE public.ai_prediction
    ADD COLUMN IF NOT EXISTS predicted_temperature
    DOUBLE PRECISION;

ALTER TABLE public.ai_prediction
    ADD COLUMN IF NOT EXISTS horizon_hours
    INTEGER;

ALTER TABLE public.ai_prediction
    ADD COLUMN IF NOT EXISTS payload
    JSONB;

ALTER TABLE public.ai_prediction
    ADD COLUMN IF NOT EXISTS created_at
    TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_ai_prediction_pond_type_created
    ON public.ai_prediction (pond_id, prediction_type, created_at DESC);

COMMIT;
