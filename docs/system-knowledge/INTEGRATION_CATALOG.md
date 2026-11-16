# Integration Catalog

| Integration | Direction | Purpose | Verification |
|---|---|---|---|
| MQTT/Mosquitto | device → core | telemetry ingest and ACK | Source verified; broker unavailable in audit |
| Socket.IO | core ↔ web/mobile | telemetry and alert realtime | Client/server source verified; runtime unverified |
| Redis | core | rate limit, cache, lockout, OTP, cooldown, publish | Source/tests exist; runtime not audited |
| RabbitMQ | infrastructure/core/AI intent | internal event routing | Compose config verified; runtime unavailable |
| BullMQ | core | notification/prediction jobs | Module dependency/source verified |
| Firebase FCM | core → device | notification token/delivery | source/test files; credentials/runtime unavailable |
| SMTP/eSMS | core → user | email/SMS notifications and OTP | source/test files; external delivery unverified |
| FastAPI AI | core → AI | production prediction request | AQS-101B/C: research forecast technically verified; operational route returns intentional 503 until risk approval, and Core fallback regression is verified |

### AQS-102 browser integration evidence

The web portal was verified through real Chromium, not source inspection alone. It sends its authenticated trigger/history calls to Core, which now scopes latest/history/trigger reads/writes through the existing pond authority service. Current FastAPI 503 and a connection-refused AI endpoint both result in `HEURISTIC_RULE` with an explicit portal notice. A test-only local API exercised the future-success vocabulary and score mapping; it does not represent a production AI service.

### AQS-101D update

FastAPI now exposes a configuration-only risk engine and an OpenAPI future-success schema, while loading no production ruleset. The integration status remains **gated**: Core receives 503 and falls back. No Core database persistence or alert side effect from an approved AI model has been tested, and no frontend change is required because the web portal consumes Core `LOW|MEDIUM|HIGH` history, not FastAPI directly.

The existing listener on port 8000 is an older process whose OpenAPI contains only `/health`; it is not the AQS-101D source and must not be used as integration/deployment evidence. Current-source HTTP testing was temporary on port 8002 and was stopped.

### AQS-101E/F/G runtime boundary

On 2026-11-16, an existing port-8001 listener exposed the expected health, research and gated prediction routes and returned research 200, invalid-payload 422 and production-gate 503. Its executable owner and working directory could not be inspected, so it is source-contract-compatible evidence only, not a deployment target. Port 8000 remains the older `/health`-only process. Core must continue to treat non-success as fallback until an owned release, approved model, approved ruleset and isolated persistence E2E are available.

No external secret or endpoint value is recorded here.

### AQS-101K acceptance evidence

Read-only HTTP against port 8001 returned health/OpenAPI 200, complete operational request 503 `RISK_RULES_PENDING_APPROVAL`, and missing-salinity request 422. The current Core boundary therefore distinguishes an approval gate from a payload failure. An opt-in local PostgreSQL persistence suite now exists, but cannot run while `localhost:5432` is refused and Docker is inaccessible. See `AQS-101_FINAL_ACCEPTANCE_REPORT.md`; this does not promote the unknown-owner port-8001 listener to deployment evidence.

### AQS-101L verified integration boundary

An owned temporary source process on loopback port 8001 was used only for acceptance testing. Core called its real `/api/predict` approval gate from the isolated PostgreSQL E2E suite; FastAPI returned 503 and Core persisted only `HEURISTIC_RULE` fallback. Separately, local HTTP verified health/OpenAPI 200 and missing-salinity 422. Positive `AI_MICROSERVICE` persistence remains limited to the explicit test-only HTTP fixture because model/risk approval is pending. No shared database, externally owned runtime or production endpoint was used.
