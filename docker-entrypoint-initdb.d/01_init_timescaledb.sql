-- =================================================================
-- Script khởi tạo CSDL TimescaleDB cho AquaSense IoT
-- Task DB-01 & DB-02: Entities & Hypertable telemetry_data
-- =================================================================

-- 1. Kích hoạt các extension cần thiết
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- 2. Tạo các kiểu ENUM nếu chưa tồn tại
DO $$ BEGIN
    CREATE TYPE role AS ENUM ('MANAGER', 'FARMER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE pondstatus AS ENUM ('ACTIVE', 'HARVESTED', 'EMPTY');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE device_status AS ENUM ('ONLINE', 'OFFLINE', 'MAINTENANCE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Bảng người dùng (users)
CREATE TABLE IF NOT EXISTS users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role role NOT NULL DEFAULT 'FARMER',
    fcm_token VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- 4. Bảng ao nuôi (pond)
CREATE TABLE IF NOT EXISTS pond (
    pond_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    pond_name VARCHAR(100) NOT NULL,
    area_m2 DOUBLE PRECISION NOT NULL,
    depth_m DOUBLE PRECISION NOT NULL,
    shrimp_density INTEGER NOT NULL,
    status pondstatus NOT NULL DEFAULT 'EMPTY',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_pond_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 5. Bảng thiết bị quan trắc IoT (device)
CREATE TABLE IF NOT EXISTS device (
    device_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pond_id UUID NOT NULL,
    device_name VARCHAR(100) NOT NULL,
    mac_address VARCHAR(50) NOT NULL UNIQUE,
    firmware_version VARCHAR(50),
    status device_status NOT NULL DEFAULT 'OFFLINE',
    last_active_at TIMESTAMPTZ,
    CONSTRAINT fk_device_pond FOREIGN KEY (pond_id) REFERENCES pond(pond_id) ON DELETE CASCADE
);

-- 6. Bảng cấu hình ngưỡng an toàn (threshold_config)
CREATE TABLE IF NOT EXISTS threshold_config (
    config_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pond_id UUID NOT NULL,
    metric_name VARCHAR(50) NOT NULL,
    min_value DOUBLE PRECISION NOT NULL,
    max_value DOUBLE PRECISION NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_threshold_config_pond FOREIGN KEY (pond_id) REFERENCES pond(pond_id) ON DELETE CASCADE,
    CONSTRAINT chk_threshold_min_max CHECK (min_value <= max_value)
);

-- 7. Bảng dữ liệu chuỗi thời gian cảm biến (telemetry_data)
CREATE TABLE IF NOT EXISTS telemetry_data (
    id BIGSERIAL,
    device_id UUID NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    temperature DOUBLE PRECISION,
    ph DOUBLE PRECISION,
    salinity DOUBLE PRECISION,
    dissolved_oxygen DOUBLE PRECISION,
    turbidity DOUBLE PRECISION,
    water_level DOUBLE PRECISION,
    is_buffered BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (id, recorded_at),
    CONSTRAINT fk_telemetry_device FOREIGN KEY (device_id) REFERENCES device(device_id) ON DELETE CASCADE
);

-- 8. Chuyển đổi bảng thành Hypertable với phân vùng theo chu kỳ 7 ngày
SELECT create_hypertable(
    'telemetry_data',
    'recorded_at',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

-- 9. Tạo các chỉ mục (indexes) tối ưu tốc độ lọc theo thiết bị và thời gian
CREATE INDEX IF NOT EXISTS idx_telemetry_device_time ON telemetry_data (device_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS telemetry_data_recorded_at_idx ON telemetry_data (recorded_at DESC);

-- 10. Cấu hình nén dữ liệu TimescaleDB (Compression Policy)
ALTER TABLE telemetry_data SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id',
    timescaledb.compress_orderby = 'recorded_at DESC'
);

SELECT add_compression_policy('telemetry_data', INTERVAL '14 days', if_not_exists => TRUE);
