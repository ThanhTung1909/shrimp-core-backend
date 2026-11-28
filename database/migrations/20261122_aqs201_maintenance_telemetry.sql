-- AQS-201 / BR-03: retain calibration telemetry without letting it become a
-- water-quality input after maintenance has ended. Additive and rerunnable.
ALTER TABLE telemetry_data
  ADD COLUMN IF NOT EXISTS is_maintenance boolean NOT NULL DEFAULT false;

-- telemetry_data is a TimescaleDB hypertable, which rejects CONCURRENTLY.
-- Run in a short, timeout-bound maintenance window instead.
CREATE INDEX IF NOT EXISTS idx_telemetry_device_maintenance_time
  ON telemetry_data (device_id, is_maintenance, recorded_at DESC);
