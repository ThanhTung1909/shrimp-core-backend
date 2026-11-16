# Functionality Inventory

Mỗi trạng thái dựa trên source và danh sách test phát hiện; không suy ra test pass nếu không có log trong audit.

| ID | Function | Actor | Evidence | Status | Hạn chế |
|---|---|---|---|---|---|
| AUTH-01 | OTP, register, login, refresh, logout/password recovery | public/authenticated | `auth.controller.ts`, auth/lockout specs | IMPLEMENTED / UNVERIFIED | Không chạy full auth suite trong audit |
| USER-01 | profile, FCM token, user CRUD/unlock | user/admin/manager | `users.controller.ts`, `users.service.ts` | IMPLEMENTED / UNVERIFIED | Manager scope theo farm mới cần UI đồng bộ |
| FARM-01 | Farm CRUD, assign/revoke manager | admin; read manager | `farms.controller.ts`, migration `20261116_*` | IMPLEMENTED / UNVERIFIED | Migration chưa xác minh trên DB |
| POND-01 | Pond CRUD, assign/revoke farmer, thresholds/logs | admin/manager/farmer read | `ponds.controller.ts` | IMPLEMENTED / UNVERIFIED | Quyền cần runtime verification |
| CROP-01 | Vụ nuôi/harvest/density | manager write | `crops.controller.ts` | IMPLEMENTED / UNVERIFIED | Controller dùng decorators một dòng, docs Swagger hạn chế |
| DEVICE-01 | CRUD/gán ao/status/báo hỏng | admin/manager; report all | `devices.controller.ts`, `report-device-fault.dto.ts` | IMPLEMENTED / UNVERIFIED | Hai endpoint report tương đương |
| TEL-01 | MQTT ingestion, dedup/ACK, history/latest | device/authenticated | telemetry service/MQTT/gateway, migration `20261113_*` | PARTIAL | Cần migration và firmware `messageId`; runtime chưa test |
| ALERT-01 | Filter/list/resolve/cooldown | scoped roles | alerts + Redis Lua reservation | IMPLEMENTED / UNVERIFIED | No E2E audit evidence |
| PRED-01 | Latest/history/trigger predictions | scoped read; admin/manager scoped trigger | strict mapper, isolated PostgreSQL, AQS-102 Chromium E2E | VERIFIED FALLBACK / PENDING_APPROVAL | Real 503/unavailable paths and test-only success mapping are verified; production model/risk rules remain unapproved |
| NOTIF-01 | preferences, FCM token, inbox/dispatch | authenticated | notifications controller/services/tests | IMPLEMENTED / UNVERIFIED | Docker/FCM unavailable |
| WEB-01 | Portal routing and API/socket client | browser user | `routes/index.ts`, services | IMPLEMENTED / UNVERIFIED | Staff create contract mismatch, xem KNOWN_ISSUES |
| MOB-01 | Mobile auth/dashboard/pond/device/alerts/settings | mobile user | navigation, services, Redux slices | IMPLEMENTED / UNVERIFIED | Không chạy Expo/device test |
| AI-01 | AI service health/preload scaler | unauthenticated | Live `GET /health` 200, `app/main.py` | VERIFIED COMPLETE | Scaler is not a water-quality predictor |
| AI-02 | Nest-compatible prediction endpoint | planned | Live `POST /api/predict` 404; absent from OpenAPI | BLOCKED | Missing predictor, metadata, real labelled data and validation metrics |

## AQS-101D correction and current integration state

The historical `AI-02` line above records an earlier audit and is superseded for the current FastAPI source: OpenAPI has both POST routes; research inference is experimental; `/api/predict` deliberately returns `503 RISK_RULES_PENDING_APPROVAL`. Core maps that non-success to its existing `HEURISTIC_RULE` fallback. A versioned FastAPI risk engine now exists but has no approved runtime configuration, so `PRED-01` remains `PARTIAL / PENDING_APPROVAL`; no AI result is persisted from this gated route.

## AQS-101E/F/G evidence refresh

The frozen AI artifact was retained after a read-only robustness audit found insufficient held-out low-DO and multi-period coverage. The Core boundary is unchanged and remains correct: an HTTP 503 is a non-success response, so it produces `HEURISTIC_RULE`, never an unapproved `AI_MICROSERVICE` record. No Core source, DTO, entity, migration, database record or frontend contract changed in this phase.

## AQS-102 browser evidence refresh

`PRED-01` is now verified end-to-end at the portal boundary on isolated infrastructure: authenticated UI → Core trigger/history → FastAPI gate or test-only contract double → PostgreSQL fixture → UI. It includes Manager foreign-pond denial. This verifies integration behavior, not production AI suitability.
