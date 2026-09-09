-- =================================================================
-- Script khởi tạo CSDL TimescaleDB cho AquaSense IoT
-- Task DB-01: Bảng dữ liệu chuỗi thời gian telemetry_data (Hypertable)
-- =================================================================

-- 1. Kích hoạt các extension cần thiết
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- 2. Tạo bảng lưu trữ chuỗi thời gian telemetry_data
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
    PRIMARY KEY (id, recorded_at)
);

-- 3. Chuyển đổi bảng thành Hypertable với phân vùng theo chu kỳ 7 ngày
SELECT create_hypertable(
    'telemetry_data',
    'recorded_at',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

-- 4. Tạo các chỉ mục (indexes) tối ưu tốc độ lọc theo thiết bị và thời gian
CREATE INDEX IF NOT EXISTS idx_telemetry_device_time ON telemetry_data (device_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS telemetry_data_recorded_at_idx ON telemetry_data (recorded_at DESC);

-- 5. Cấu hình nén dữ liệu TimescaleDB (Compression Policy)
ALTER TABLE telemetry_data SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id',
    timescaledb.compress_orderby = 'recorded_at DESC'
);

SELECT add_compression_policy('telemetry_data', INTERVAL '14 days', if_not_exists => TRUE);
