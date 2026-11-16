# Database Catalog

TypeORM entities detected in `shrimp-core-backend/src/modules/**/entities`:

| Table/entity | Purpose / relationships |
|---|---|
| users, user_sessions | identities, sessions and role ownership |
| farms, pond | farm manager ownership; pond belongs to user/farm |
| pond_farmer_assignments | many-to-many operational access for farmer and pond |
| device | device optionally belongs to pond |
| telemetry_data | time-series sensor records; index on device/time and message ID |
| telemetry_ingest_receipts | unique device/message idempotency ledger |
| threshold_config, alert, ai_recommendation | alert policy and emitted alerts/recommendations |
| ai_prediction | stored prediction result/metadata |
| shrimp_batches, harvest_logs | farming production lifecycle |
| manual_test_log | manual water-quality samples |
| notification_preference, notification_token, notification_delivery | notification configuration/delivery trace |

Migrations present include auth lock state, notification tables/tokens, farms/crops, farmer assignment, telemetry idempotency and nullable farm manager ownership. `DB_SYNCHRONIZE=false` is the template default: migrations need manual operational handling. AQS-101B/C performed only read-only PostgreSQL queries: 70,297 telemetry rows across 44 ponds were used to train/evaluate an experimental model. No `ai_prediction` row, schema, migration or production data was written during this task.

## AQS-101L isolated persistence evidence

The acceptance suite created a separate disposable database named `shrimp_aqs101_prediction_e2e` only after confirming it did not already exist and that the disposable role had `CREATEDB`. It synchronized the existing entities, queried persisted `ai_prediction` rows and alert count, then dropped only that database. It did not access, truncate, migrate or reset any existing Core/AI database, and the fixture database was confirmed absent after the suite.
