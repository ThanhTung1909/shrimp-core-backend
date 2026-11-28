# AQS-203 Development Handover — Alerts & Devices RBAC

**Date:** 2026-11-24
**Repository / branch:** `shrimp-core-backend` / `feature/AQS-203_fix-alerts-devices-rbac`
**Baseline:** `origin/develop@196c41874fdb07467832731490e3b83b3c5f6a37`
**Status:** `AQS203_PARTIAL_PASS`

## Git safety

The main project was initially at AQS-202 `1e220ad` with one uncommitted edit
to `src/modules/users/users.service.ts`. Its verified 67-line diff was saved
as a stash with message `aqs203-preflight-users-service-2026-11-24` before
switching branches. Locate it by that exact message and restore it only on the
AQS-202 branch; do not rely on an ordinal such as `stash@{0}`. The old AQS-203 worktree was verified clean,
untracked-free, and at `196c418` before `git worktree remove`; no file was
deleted manually. `origin` was fetched and `origin/develop` resolved to
`196c418`.

## Audit and remediation

| Area / endpoint | Previous policy | Risk | AQS-203 policy |
|---|---|---|---|
| `GET /alerts` | FARMER assignment **or** `pond.user_id`; MANAGER farm owner **or** `pond.user_id` | A legacy pond owner or Manager with a matching user ID could enumerate another scope, including filtered/paginated counts. | FARMER requires `EXISTS pond_farmer_assignments`; MANAGER requires Farm ownership. The DB predicate is applied before `skip/take` and `getManyAndCount`. |
| `PATCH /alerts/:id/resolve` | Same legacy owner fallbacks in per-alert checks | Cross-scope state mutation. | FARMER must have a current assignment; MANAGER must own the pond's Farm. Missing pond relation/scope returns 403. |
| `GET /devices` | FARMER assignment **or** pond owner; MANAGER Farm owner **or** pond owner | Filtered list, total and pages could disclose foreign devices. | Assignment/Farm predicates only, before pagination/count. |
| `GET /devices/:id`, report fault | FARMER owner fallback; MANAGER user-ID fallback | Detail and fault-report IDOR. | Current assignment only for FARMER; Farm ownership only for MANAGER. |
| Device create/update/assign/status/delete | Manager could pass a pond whose `userId` matched even without a managed Farm. | Cross-Farm mutation. | All Manager object and target-pond paths use one Farm-ownership assertion. |

All public Alerts/Devices service entry points now reject an unsupported role.
Assignment/Farm repository errors are not caught or converted to success, so
authorization fails closed. ADMIN behavior is unchanged.

`PondsService` remains the reference for list scoping: with its production
assignment repository injected, FARMER list access is assignment-only and
MANAGER list access is Farm-owner-only. Its regression suite passed unchanged.

## AQS-202 security integration

The initial AQS-202 audit failure was a stale test double, but the comparison
also found that AQS-203 had diverged from AQS-202 and had lost the Telemetry
HTTP guard/object-scope changes. `origin/develop@196c418` and AQS-202
`1e220ad` share only `e40b8e7`; the old AQS-202 branch lacks the later
Predictions integration and a wholesale cherry-pick would delete or overwrite
approximately 3,800 current Predictions lines. It was therefore rejected.

| Component | Integration decision | Evidence |
|---|---|---|
| `test/security-audit.spec.ts` | Updated only the UsersService mock and the expectation to model current Manager farm scope. | Stack trace called the real controller's `assertManagerCanManageUser`; no production Users authorization changed. |
| Telemetry controller | Restored `JwtAuthGuard`, authenticated user extraction, and authorization-before-read for latest/history. | New controller regression proves a denied scope prevents the history query. |
| Telemetry service | Restored device lookup, unassigned-device denial, and delegation to `PondsService.findPondById`. | Service tests cover allowed assignment, unknown/unassigned device, and cross-pond denial. |
| `TelemetryModule` / Ponds dependency | No source change required. | Module already imports `PondsModule` and Ponds exports `PondsService`; no new cycle. |
| Predictions | No source change. | Existing controller has JWT/Roles guards and service invokes Ponds scope; targeted regression passed. |

No migration, `.env`, MQTT, Redis, RabbitMQ, or startup path changed.

## Changed files

- `src/modules/alerts/alerts.service.ts`
- `src/modules/alerts/alerts.service.spec.ts`
- `src/modules/devices/devices.service.ts`
- `src/modules/devices/devices.service.spec.ts`
- `src/modules/telemetry/telemetry.controller.ts`
- `src/modules/telemetry/telemetry.controller.spec.ts`
- `src/modules/telemetry/telemetry.service.ts`
- `src/modules/telemetry/telemetry.service.spec.ts`
- `test/security-audit.spec.ts`
- `test/users-unlock.spec.ts`
- `test/functional-api.spec.ts`
- `test/all-entities.spec.ts`
- `docs/AQS-203_DEVELOPMENT_HANDOVER.md`
- `docs/system-knowledge/CURRENT_STATE.md`
- `docs/system-knowledge/TEST_COVERAGE.md`
- `docs/system-knowledge/TASK_HISTORY.md`

## Verification

| Check | Result | Scope |
|---|---|---|
| Alerts + Devices Vitest | **PASS, 36/36** | ADMIN continuity, assignment-only predicates, foreign detail denial, legacy-owner denial, revoke denial, Manager Farm scope, pagination/count query ordering and mutations. |
| Ponds service/controller Vitest | **PASS, 64/64** | Existing Ponds RBAC regression. |
| `npm run build` | **PASS** | Nest TypeScript build. |
| `npm run lint` | **PASS** | Exit 0; 17 existing warnings, no lint errors. |
| `git diff --check` | **PASS** | No whitespace errors. |
| AQS-202 security audit | **PASS, 58/58** | The stale test double now follows the existing UsersService contract and includes the foreign-scope Manager denial. |
| Cross-module RBAC/security Vitest | **PASS, 280/280** | Alerts, Devices, Ponds, Telemetry controller/service/integration and Predictions controller/service/processor/mapper. |
| Live HTTP | **LIVE_E2E_BLOCKED** | No listener on 3000/5173/5432/6379/5672; read-only GET to `127.0.0.1:3000/alerts` could not connect. The backend was not started because its AppModule is not read-only. |
| Final isolated AQS-203 regression | **PASS, 357/357; 1 skipped** | 13 selected Vitest files: AQS-202 security audit, Alerts, Devices, Ponds, Telemetry, Predictions and Users unlock. `all-entities` is explicitly skipped without an owned loopback database. |
| Final Core build / lint / diff | **PASS** | `npm run build`, `npm run lint` (exit 0; 17 warnings), `git diff --check` and cached diff check. |
| Web lint / production build | **PASS** | ESLint exit 0 (139 existing warnings); TypeScript and Vite production build passed. Build reports the existing 500 kB chunk advisory. |
| Web controlled-API Playwright | **PASS, 19/19** | Vite/Chromium suite. API requests are controlled/mocked; this is not a live Core authorization result. |

## Final regression safety note

An attempted unqualified `npm test` exposed two legacy integration suites that
are unsafe as a default local gate: `all-entities` bootstraps `AppModule` and
writes entities to the configured database, while `functional-api` uses the
configured Redis connection. The former also stopped on an out-of-date local
schema (`ai_prediction.prediction_type`). No suite was rerun against shared
infrastructure. `all-entities` now requires the explicit
`AQS_ALL_ENTITIES_E2E=true` opt-in plus an exact loopback database name before
it can execute; otherwise it skips. The UsersService fixtures in
`users-unlock` and `functional-api` were aligned with the existing fail-closed
Manager pond/Farm scope contract. No production authorization behavior was
weakened or changed for these test repairs.

`functional-api` and the other real-Redis/AppModule suites remain
**BLOCKED** pending an explicitly owned, isolated Redis/database fixture.
Accordingly, this handover records `SOURCE_TEST_PASS` only for the isolated
selection above and `LIVE_E2E_BLOCKED`; it does not claim full-suite or live
HTTP acceptance.

## Remaining limitations

There is no authenticated, owned fixture or running AQS-203 process, so live
role/JWT/assignment-revocation HTTP evidence cannot be claimed. No database,
Redis, MQTT, RabbitMQ, runtime configuration, migration, commit, push, merge,
or deployment was changed.

## AQS-203 HTTP-only live acceptance — 2026-11-24

**Status: `AQS203_LIVE_RBAC_PASS`.** The worktree based on
`b4128454d981531d2412e0c635543e9aa1e9a4bc` was started once with the
process-only override `AQS_HTTP_ONLY=true`; `.env` was not edited. The process
was stopped after the read-only matrix. This mode makes TypeORM schema sync,
migrations and schema drops false; skips Timescale bootstrap; omits MQTT,
WebSocket Redis subscriber, device-health cron, BullMQ root/queues/processors,
notification listener and prediction scheduler; blocks FCM initialization; and
allows only `GET`, `HEAD`, and `OPTIONS` before a controller or Redis rate
limiter can run. The ordinary production path is unchanged when the flag is
absent/false.

The live server connected only for PostgreSQL/Redis reads required by JWT and
route queries. Startup logged the HTTP-only Timescale/FCM skips and no MQTT,
BullMQ, worker, scheduler or subscriber startup. No migration, seed, schema
synchronization, MQTT/RabbitMQ publication, Redis write/ACK/purge, or HTTP
mutation was issued.

| Actor / probe | HTTP evidence |
|---|---|
| ADMIN | Alerts page/filter `200` (866 / 9 totals, page size 2); Devices page/detail `200` (589 total, page size 2). |
| MANAGER A (owning Farm) | Alerts/Devices pond filter `200` (9 / 3 totals, page size 2); Device detail `200`. |
| MANAGER B (foreign Farm) | Same foreign Alert/Device filters `200` with `0` total/records; foreign Device detail `403`. |
| Assigned FARMER | Assigned Alert/Device filters `200` (7 / 3 totals, page size 2); assigned Device detail `200`. |
| Unassigned FARMER | Foreign Alert/Device filters `200` with `0` total/records; foreign Device detail `403`. |

Read-only SQL in an explicit `BEGIN READ ONLY` transaction confirmed: Manager
A owns the selected Farm; Manager B does not; the assigned FARMER has the
selected `pond_farmer_assignments` row; and the unassigned FARMER has none.
The live process used short-lived, in-memory signed access tokens matching the
existing active users and token versions; tokens, IDs, passwords and response
records were neither printed nor saved. Alerts has no `GET /alerts/:id` route
in current source, so Alert scope was validated through the scoped list/filter
endpoint; the only Alert detail-like route is the blocked mutation
`PATCH /alerts/:id/resolve`.

### Added safety evidence

| Check | Result |
|---|---|
| HTTP-only unit/module tests | **PASS, 6/6** — explicit flag, method gate before controller/rate-limit writes, TypeORM no schema init, Timescale skip, and absence of MQTT/gateway/cron/listener/BullMQ processor providers. |
| FCM startup flag | **PASS** — the focused FCM spec proves HTTP-only does not invoke Firebase SDK initialization; combined HTTP-only + FCM tests are **13/13**. |
| AQS-203 selected cross-module Vitest | **PASS, 363/363** — previous 357 assertions plus HTTP-only suite; Alerts, Devices, Ponds, AQS-202 Telemetry security, Predictions and Users unlock. |
| Core build / lint / whitespace | **PASS** — `npm run build`; `npm run lint` exit 0 with 17 pre-existing warnings; `git diff --check` and cached check clean. |
