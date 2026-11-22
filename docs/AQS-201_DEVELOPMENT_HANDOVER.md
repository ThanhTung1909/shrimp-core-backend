# AQS-201 — BR-03 Maintenance Telemetry Handover

**Worktree:** `D:\Khóa Luận\Project\aqs201-worktree`

**Branch/base:** `feature/AQS-201_preserve-maintenance-status` from
`origin/develop@e40b8e7`.

## Implementation

Telemetry persistence and threshold evaluation take a short shared lock on the
current Device row. The status observed under that lock controls both the
`ONLINE` update and threshold processing, removing the stale snapshot race with
an operator transition to `MAINTENANCE`. Maintenance telemetry is retained as
diagnostic data with `is_maintenance=true`; latest telemetry queries and
prediction selection exclude it. MQTT idempotency receipts and ACK behaviour
remain intact.

## Database audit — 2026-11-22

Runtime configuration identifies `localhost:5432` and `DB_SYNCHRONIZE=false`.
A read-only application-account connection reached existing PostgreSQL 16
database `shrimp_local_db`; its server reports a container-network address
behind the loopback mapping. Required tables exist and the AQS-201 column/index
do not. The database already contains **586 devices, 70,309 telemetry rows and
864 alerts**. This is not sufficient evidence that it is a disposable fixture.

No `psql` or `pg_dump` executable is available, while Docker configuration and
engine access are denied. A required verified backup therefore cannot be made.
No migration, database write, TEST_ONLY fixture, broker publication or cleanup
was attempted.

The migration `database/migrations/20261122_aqs201_maintenance_telemetry.sql`
is additive/rerunnable: it adds `telemetry_data.is_maintenance boolean NOT NULL
DEFAULT false` and a supporting latest-telemetry index. It deliberately does
not reclassify historical rows.

## Evidence

- Backend build: PASS.
- Device, MQTT gateway, Telemetry and Prediction regression: **129/129 PASS**.
- Real PostgreSQL/MQTT E2E, backup and migration: **BLOCKED** by missing backup
  tooling and unproven ownership of the populated local database. No shared or
  production substitute was used.

## Git

Source and migration changes are intentionally uncommitted and unpushed.

## Final completion — 2026-11-22

**This section supersedes the earlier `AQS201_PARTIAL` audit above. Status is
`AQS201_BR03_PASS` for local acceptance.**

Root cause was a stale Device snapshot: telemetry could decide to restore
`ONLINE` or create threshold alerts after an operator switched to
`MAINTENANCE`. Persistence and threshold evaluation now lock the current Device
row. Maintenance samples are retained with `is_maintenance=true`, while latest
telemetry/prediction selection excludes them. Live PostgreSQL uncovered and
fixed a second issue: PostgreSQL rejects `FOR SHARE` on the nullable TypeORM
LEFT JOIN for `Device.pond`; the code now locks only Device then reads pond
context separately inside the same transaction.

Database target was verified as local `shrimp_local_db` at `localhost:5432`,
PostgreSQL 16.15, with `DB_SYNCHRONIZE=false`. Verified pre-migration backup:
`C:\AquaSense-Backups\AQS-201\shrimp_local_db-aqs201-pre-migration-20261122-223600-verified.dump`
(`pg_dump -Fc` exit 0; 1,924,729 bytes; SHA-256
`524E52EC50A9EAD3E11FA9F956BA6B3CF34A1AE12D8F053919206228DCC0FF34`; 235
`pg_restore --list` entries). It is outside Git.

Migration applied and rerun idempotently: `is_maintenance boolean NOT NULL
DEFAULT false`, and valid index
`idx_telemetry_device_maintenance_time(device_id, is_maintenance, recorded_at
DESC)`. `telemetry_data` is a TimescaleDB hypertable, so it rejects concurrent
index creation; the migration uses normal `CREATE INDEX IF NOT EXISTS` in a
short transaction with `lock_timeout=5s`, after zero active sessions/waiting
locks. Historical data remains `false` because provenance cannot be inferred.
Counts remained 586 devices / 70,309 telemetry / 864 alerts.

`scripts/aqs201-live-e2e.mjs` passed against the existing local MQTT broker at
`127.0.0.1:1883`, real `TelemetryMqttService`, TypeORM and PostgreSQL. A
UUID-labelled `AQS201_TEST_ONLY` fixture proved an ONLINE-to-MAINTENANCE race,
pH 4.0 / DO 1.0 / temperature 42 MQTT payloads, and a duplicate message: 4
maintenance rows, 4 receipts, 0 alerts, final MAINTENANCE, three `stored` ACKs
and one `duplicate` ACK; latest non-maintenance result was null. Manifest:
`C:\AquaSense-Backups\AQS-201\aqs201-live-fixture-65ff8e8d-4fb9-442c-bf40-eedd35b46cf3.json`.
The same run then proved normal behavior remains intact: an OFFLINE fixture
device became ONLINE after valid MQTT telemetry, and a subsequent online
high-temperature sample produced exactly one fixture Alert.
Finally cleanup deleted only manifest UUIDs; post-check found zero TEST_ONLY
fixture rows and zero `AQS201-*` telemetry rows.

Validation: build PASS; focused Telemetry/Gateway/Device/Prediction/Alert
regression 138/138 PASS; lint exit 0 with pre-existing warnings; `git diff
--check` PASS. No commit or push occurred.

## Publication

- Source acceptance commit: `84e0e30f7e0e97c6fd5c176ff6929dac1707fa5a`
  (`fix(aqs-201): preserve maintenance status during MQTT telemetry`).
- Target branch: `feature/AQS-201_preserve-maintenance-status`.
- Initial publication was normal-pushed to `origin` and fetch-verified at
  `56f47daf40226b4e5b4e468444b1fc933308e368`; its upstream is
  `origin/feature/AQS-201_preserve-maintenance-status`.
- Production rollout remains out of scope; this is local-development and
  controlled-local-infrastructure evidence only.
