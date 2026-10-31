BEGIN;

ALTER TABLE public.ai_prediction
    ADD COLUMN IF NOT EXISTS is_fallback
    BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.ai_prediction
    ADD COLUMN IF NOT EXISTS prediction_source
    VARCHAR(50) NOT NULL DEFAULT 'AI_MICROSERVICE';

COMMIT;
