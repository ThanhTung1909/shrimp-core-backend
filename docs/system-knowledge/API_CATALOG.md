# API Catalog

Core base URL is configured by clients; Swagger source config exposes `/api/docs`.

| Module | Endpoints discovered | Auth/role evidence |
|---|---|---|
| Auth | `/auth/send-otp`, `forgot-password`, `verify-otp`, `register`, `login`, `refresh`, `reset-password`, `me`, `change-password`, `logout`, `logout-all` | Controller guards/decorators; register has manager role decorator |
| Users | `/users`, `/users/:id`, `/users/profile`, `/users/fcm-token`, `/:id/unlock` | admin/manager CRUD; any role own/get rules in service |
| Farms | `/farms`, `/:id`, `/:id/ponds`, `/:id/assign-manager`, `/:id/revoke-manager` | write/admin; reads admin/manager |
| Ponds | `/ponds`, farmer assignment, thresholds, manual logs subroutes | CRUD/assignment/threshold write admin-manager; read scope in service |
| Crops | `/crops`, `/ponds/:pondId/crops`, batch detail/density/harvest/status | manager write decorators; service applies role scope |
| Devices | `/devices`, `/:id/pond`, `/:id/status`, `/:id/report-fault`, `/:id/report-broken` | report all roles; config writes admin-manager |
| Telemetry | `/telemetry/device/:deviceId/latest|history`; Socket.IO `/telemetry` | controller/gateway JWT evidence |
| Alerts | `/alerts`, `/:id/resolve` | role scope in service |
| Predictions | `/predictions/pond/:pondId/latest|history|trigger`, `/trigger-active` | triggers admin-manager |
| Notifications | preferences, FCM token, inbox at `/notifications` | authenticated controller |

Input DTOs are colocated under each module. Response contracts require Swagger/runtime inspection before external integration. Mobile has explicit consumers for auth, ponds, devices, alerts, predictions and notifications. Web uses service wrappers and Socket.IO; its complete method catalog was not runtime-verified.

### Prediction integration boundary (AQS-101)

The Core request adapter carries `pondId`, `currentDO`, `currentPH`, `currentTemp` and an ISO `timestamp`; it carries `salinity` and `turbidity` only when fresh telemetry supplied finite values. The response adapter accepts only external `riskLevel` values `SAFE`, `WARNING`, `DANGER`, mapping them to persisted `LOW`, `MEDIUM`, `HIGH`, and accepts only a numeric `riskScore` from 0 to 100 before converting it to 0 to 1. FastAPI now deliberately returns `503 RISK_RULES_PENDING_APPROVAL` on `/api/predict`; Core uses `HEURISTIC_RULE` fallback and does not persist `AI_MICROSERVICE` for that response.

## AQS-101D compatibility decision

The FastAPI future-success schema remains compatible with the mapper: `predictedDO`, `predictedPH`, `riskLevel` in `SAFE|WARNING|DANGER`, and `riskScore` in inclusive `0..100`. It is not yet an operational path. The FastAPI gate additionally requires `MODEL_APPROVED && RISK_RULES_APPROVED`; current missing rules are intentionally reported with the existing `RISK_RULES_PENDING_APPROVAL` code so Core needs no contract change. No backend DTO/entity/migration change was required or made.

## AQS-101K contract acceptance boundary

FastAPI `ForecastRequest` requires all seven fields: UUID `pondId`, finite/range-valid DO, pH, temperature, salinity and turbidity, plus a timezone-aware timestamp. Core now validates that exact boundary before HTTP. A missing, non-finite or out-of-range sensor value prevents the outbound request and selects the existing `HEURISTIC_RULE` fallback; Core never invents salinity/turbidity merely to obtain a 503 or 422. A valid complete request reaches the intended FastAPI 503 approval gate today. The future-success mapper remains `SAFE→LOW`, `WARNING→MEDIUM`, `DANGER→HIGH`, with a single 0–100 to 0–1 conversion.

## AQS-101L persistence verification

No API contract changed. The exact seven-field boundary, response vocabulary and one-time score normalization were persisted and queried in an isolated PostgreSQL acceptance run. The real FastAPI 503 is a transport failure by design and is stored only as `HEURISTIC_RULE` fallback; `AI_MICROSERVICE` remains reserved for a schema-valid successful response, which was exercised solely through the test-only fixture.

## AQS-102 authorization and portal verification

`GET /predictions/pond/:pondId/latest`, `GET /predictions/pond/:pondId/history`, and `POST /predictions/pond/:pondId/trigger` now pass the authenticated actor into the existing pond access service. Browser/API evidence verified an authorized Manager path and a foreign-pond `403`; the earlier foreign-history `200` was a reproduced defect. The web history presents normalized Core score values as percentages exactly once and uses a fallback-specific label/message when `isFallback=true`.
