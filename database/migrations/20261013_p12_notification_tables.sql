-- ====================================================================
-- Migration: 20261013_p12_notification_tables.sql
-- Description: Tạo các bảng và enum cho Multi-Channel Notification Dispatcher
-- Feature: P1-2 Multi-Channel Notifications (FCM, SMS, Email)
-- ====================================================================

-- --------------------------------------------------------------------
-- UP MIGRATION
-- --------------------------------------------------------------------

-- 1. Create Enums if they do not exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_channel') THEN
        CREATE TYPE notification_channel AS ENUM ('FCM', 'SMS', 'EMAIL');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'delivery_status') THEN
        CREATE TYPE delivery_status AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED');
    END IF;
END $$;

-- 2. Notification Preferences Table
CREATE TABLE IF NOT EXISTS notification_preference (
    preference_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    severity alert_level NOT NULL,
    channel notification_channel NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT fk_notification_preference_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    CONSTRAINT uq_notification_preference_user_sev_chan UNIQUE (user_id, severity, channel)
);

CREATE INDEX IF NOT EXISTS idx_notification_preference_user_id ON notification_preference(user_id);

-- 3. FCM Device Registration Tokens Table (Multi-Device)
CREATE TABLE IF NOT EXISTS notification_token (
    token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    token VARCHAR(500) NOT NULL,
    platform VARCHAR(50) NOT NULL DEFAULT 'android',
    device_identifier VARCHAR(150),
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT fk_notification_token_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    CONSTRAINT uq_notification_token_user_token UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_notification_token_token ON notification_token(token);
CREATE INDEX IF NOT EXISTS idx_notification_token_user_active ON notification_token(user_id, is_active);

-- 4. Notification Delivery Records Table (Audit & Deduplication)
CREATE TABLE IF NOT EXISTS notification_delivery (
    delivery_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID NOT NULL,
    user_id UUID NOT NULL,
    channel notification_channel NOT NULL,
    status delivery_status NOT NULL DEFAULT 'PENDING',
    recipient VARCHAR(255),
    attempt_count INT NOT NULL DEFAULT 1,
    last_attempt_at TIMESTAMP WITH TIME ZONE,
    sent_at TIMESTAMP WITH TIME ZONE,
    failure_code VARCHAR(100),
    failure_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT fk_notification_delivery_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_dedup ON notification_delivery(alert_id, user_id, channel);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_user_created ON notification_delivery(user_id, created_at DESC);

-- --------------------------------------------------------------------
-- DOWN MIGRATION (ROLLBACK)
-- --------------------------------------------------------------------
-- DROP TABLE IF EXISTS notification_delivery CASCADE;
-- DROP TABLE IF EXISTS notification_token CASCADE;
-- DROP TABLE IF EXISTS notification_preference CASCADE;
-- DROP TYPE IF EXISTS delivery_status;
-- DROP TYPE IF EXISTS notification_channel;
