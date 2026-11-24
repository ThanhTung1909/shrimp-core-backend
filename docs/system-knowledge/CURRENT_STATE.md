# Current State and Handover

## AQS-203 — Safe HTTP-only live RBAC acceptance — 2026-11-24

**Status: `AQS203_LIVE_RBAC_PASS`.** The AQS-203 worktree based on
`b4128454d981531d2412e0c635543e9aa1e9a4bc` passed direct HTTP-only RBAC
acceptance against existing data. `AQS_HTTP_ONLY=true` was a process override,
not an `.env` edit; the process was stopped immediately afterwards. Its safety
gate blocked non-read methods before controllers/rate limiting, forced no
TypeORM schema sync/migrations/drops, skipped Timescale, MQTT, Redis
subscribers/WebSocket gateway, BullMQ queues/processors, schedulers, cron,
notification listener and FCM initialization. PostgreSQL and Redis were used
only for JWT/read queries.

Live read-only evidence: ADMIN lists/details returned 200; Manager A saw
own-Farm Alerts/Devices (totals 9/3) and detail 200; Manager B saw foreign
filters as empty and Device detail 403; assigned FARMER saw assigned scope
(7/3) and detail 200; unassigned FARMER saw foreign lists empty and detail
403. The transaction-only DB check confirmed both Farm ownership predicates,
the assigned farmer record and the zero-assignment farmer predicate. No
mutation, migration, seed, schema change, Redis write, broker action, commit,
push or merge occurred. Alert detail is not an HTTP GET route in current
source, so its scoped filter list is the applicable read endpoint.

Source verification now passes: HTTP-only tests **6/6** plus the FCM startup
flag (combined **13/13**), selected AQS-203 cross-module suite **363/363**,
Core build, lint (17 baseline warnings) and
both whitespace checks. See `docs/AQS-203_DEVELOPMENT_HANDOVER.md` for the
sanitized HTTP matrix and implementation impact.

## AQS-203 — Alerts & Devices assignment-only RBAC — 2026-11-24

**Status: `AQS203_PARTIAL_PASS`.** Alerts and Devices no longer treat
`pond.userId` as a FARMER or MANAGER authorization alternative. FARMER reads
and Alert resolve require a current `pond_farmer_assignments` record; MANAGER
reads and mutations require ownership of the pond's Farm. Query predicates are
applied before pagination/count, detail/fault/mutation paths reuse the same
object checks, unknown roles are denied, and authorization-repository failures
are not converted into access.

Focused Alerts/Devices regression passed **36/36** and Ponds service/controller
regression passed **64/64**. AQS-202 security audit now passes **58/58** after
the stale UsersService mock was aligned with the existing Manager-scope
contract. Comparison also found missing Telemetry HTTP protection on this
diverged branch, so the controller `JwtAuthGuard` and device-to-pond scope
check were restored selectively; the cross-module AQS-203 security regression
passes **280/280**. A wholesale cherry-pick was rejected because AQS-202 is
based on `e40b8e7` and would overwrite later Predictions integration. Core
build, lint (17 existing warnings) and `git diff --check` pass.

Live E2E is **BLOCKED**. Ports 3000, 5173, 5432, 6379 and 5672 had no listener
and a read-only GET to `/alerts` could not connect. Starting AppModule would
connect DB/Redis/BullMQ and subscribe background integrations, so it was not
started. No database, broker, cache, runtime config, commit, push or merge was
changed. The AQS-202 local edit remains preserved in the stash identified by
message `aqs203-preflight-users-service-2026-11-24`; see the handover for safe
restoration without relying on a stash ordinal.

Final source-only revalidation for AQS-203 passed **357/357** selected,
isolated Vitest assertions with **1 explicit database-integration skip**;
Core build/lint/diff checks passed (lint has 17 existing warnings). Web lint
passed with 139 existing warnings, its TypeScript/Vite production build passed,
and the controlled-API Playwright suite passed **19/19**. This is
`SOURCE_TEST_PASS`, not full runtime acceptance: default Core test discovery
includes legacy AppModule/database and real-Redis suites, so it is
**BLOCKED** pending an owned fixture. Live HTTP remains
`LIVE_E2E_BLOCKED`; no server, migration, seed, Redis, MQTT or RabbitMQ
operation was performed.

## AQS-202 release acceptance — 2026-11-24

**Status: `AQS202_PARTIAL_PASS`.** Revalidated source/build/regression evidence
is clean within scope: Core AQS-202 security selection passed **313/313**;
Core build passed and lint exited 0 with 18 existing warnings. Frontend lint
exited 0 with 139 existing warnings, typecheck/production build passed, and
the Vite/Chromium controlled-API suite passed **19/19**. FARMER does not call
the restricted farm directory and only uses the scoped pond response; the
browser coverage retains ADMIN/MANAGER filters, FARMER empty state, Monitoring
and AI Analysis behavior.

Live HTTP acceptance is **BLOCKED**, so this is not `FULL_PASS`: no Backend,
PostgreSQL, Redis, MQTT, RabbitMQ or owned fixture listener exists. Starting
the current AppModule against the shared configuration is unsafe because it
opens DB/Redis/BullMQ connections, runs Timescale initialization, subscribes
MQTT, enables workers, and defaults background scheduling on. No service,
request, account, token, database, Redis key, queue, migration or runtime
configuration was changed. Direct HTTP JWT revocation and Manager/Farmer
cross-pond evidence remains regression-only, not live confirmation.

Read-only merge-tree inspection found no textual conflict marker between the
AQS-201 and AQS-202 versions of `TelemetryService`, but they overlap. Any
future integration must retain both AQS-202 `assertDeviceReadAccess` and the
AQS-201 maintenance lock/`is_maintenance` persistence and prediction exclusion;
no merge was performed here.

## Web RBAC — FARMER `/devices` farm-directory request — 2026-11-24

**Status: `IMPLEMENTED / BROWSER-MOCK-VERIFIED`.** Root cause was Frontend
`Sensors_Devices` invoking `GET /farms?limit=100` unconditionally while the
Backend correctly limits all Farms readers to ADMIN and MANAGER. FARMER now
does not call the farm directory; the Devices filter derives unique farm
options only from `farmId` values in the already scoped `GET /ponds` result.
This preserves the Backend assignment boundary and avoids N+1 requests.

ADMIN and MANAGER retain their original farm-directory request and filters.
`/monitoring` already restricted farm-directory/staff reads to management
roles; `/ai-analysis` uses scoped ponds and does not use Farms. Browser
regression against Vite with controlled API responses passed **19/19**,
including FARMER Devices/no-assignment/Monitoring/AI routes and
ADMIN/MANAGER Devices. Backend Farm/Pond/Device RBAC regression passed
**56/56**. Frontend lint has 0 errors (140 existing warnings); typecheck and
production build passed, with only the existing >500 kB chunk advisory.

Live UI/API verification remains **BLOCKED**: no Backend, database or Redis
fixture listener is available. No database, runtime configuration, Backend
policy, migration, commit, push or merge changed.

## AQS-202 — real Web UI & API security E2E attempt — 2026-11-23

**Status: `AQS202_WEB_E2E_PARTIAL`.** Runtime preflight found no listener for
the Backend, Vite, PostgreSQL, Redis, MQTT, or designated fixture ports. Docker
engine/config access is denied, and the documented local project database is
shared/populated rather than an owned disposable fixture. No browser or live
HTTP request was sent; no TEST_ONLY identity, token, Redis key, device,
assignment, telemetry, or prediction was created or changed. Therefore the
required Admin/Manager/Farmer flows, revoked-token/logout checks, and
cross-pond IDOR cases remain **BLOCKED**, not failed or passed.

Source review confirms that Telemetry latest/history is guarded by JWT and
authorizes device-to-pond scope before querying, while Predictions retains
JWT/role/object-scope enforcement. The portal client attaches Bearer tokens,
serializes refresh through one shared promise, preserves 403 as an error, and
clears session storage on terminal refresh failure. Non-runtime regression
passed: the AQS-202 security selection passed **313/313** across 11 Vitest
files; `npm run build` passed; `git diff --check` passed. These are not live
browser/API E2E evidence. Chromium/Playwright 1.55.0 is installed. No source,
frontend, environment, database, migration, commit, push, or merge changed.

**Required unblock:** an explicitly owned loopback fixture with verified
TEST_ONLY Admin, Manager, Farmer, Farm A/Farm B, ponds/devices and Redis-backed
JWT revocation, plus permission to run the real Backend and Vite against it.

## AQS-202 — secure telemetry and prediction object authorization — 2026-11-22

**Status: `AQS202_SECURITY_PASS`.** Backend branch
`feature/AQS-202_secure-telemetry-predictions` was created from verified
`origin/develop@e40b8e7`. Telemetry HTTP latest/history endpoints now enforce
`JwtAuthGuard` and authorize the target device through its pond before querying
telemetry; MQTT device/broker ingestion is deliberately unchanged. Predictions
already applied JWT, role and pond object scope before external AI/read/write
operations and were regression-tested. Focused telemetry/pond/prediction
security regression **115/115 PASS**, `npm run build` PASS, and lint exit 0
(18 baseline warnings outside the AQS-202 edits). Frontend bearer
token/error handling and AI request boundary were audited; no source change
was required in either repository. No database/broker runtime test, commit,
push, merge, migration, or deployment occurred.

The former `security-audit` **56/57** failure was repaired as a stale test
double: production Manager scope enforcement already existed; the mock omitted
it and falsely described unrestricted Manager access. The suite now passes
**58/58**, with a foreign-scope Manager `403` regression. Expanded
Telemetry/Predictions/Ponds/Users/lockout authorization regression passes
**233/233**. HTTP E2E remains explicitly **BLOCKED**: no isolated fixture
stack is listening and the known database is populated shared project data.

## AQS-201 — BR-03 final local acceptance — 2026-11-22

**Status: `AQS201_BR03_PASS`.** The AQS-201 worktree now has a verified
pre-migration `pg_dump -Fc` archive outside Git, and the additive
`telemetry_data.is_maintenance` schema/index migration is applied on the
existing local PostgreSQL 16.15 `shrimp_local_db`. Counts are preserved at 586
devices / 70,309 telemetry / 864 alerts. TimescaleDB rejected concurrent index
creation, so the valid index was created in a short transaction with a 5-second
lock timeout after a clean lock/session preflight; rerun is idempotent.

Real TypeORM/PostgreSQL TOCTOU verification and existing-local-broker MQTT E2E
passed. UUID-owned `AQS201_TEST_ONLY` fixture telemetry proved maintenance
status preservation, `isMaintenance=true`, no alert, `stored` ACKs, duplicate
ACK/idempotency, and exclusion from latest non-maintenance telemetry. Exact
fixture cleanup restored baseline counts and left zero TEST_ONLY rows. Build
PASS, focused Telemetry/Gateway/Device/Prediction/Alert regression 138/138
PASS, lint exit 0 with baseline warnings. No commit/push occurred.

## AQS-201 — BR-03 maintenance telemetry protection — 2026-11-22

**Status: `AQS201_PARTIAL_E2E_BLOCKED`.** The Core AQS-201 worktree at
`feature/AQS-201_preserve-maintenance-status` (base `origin/develop@e40b8e7`)
now locks the current Device row during telemetry persistence and immediately
before threshold evaluation. This eliminates the stale-status window that
could revive a newly-maintained device or emit a calibration alert. Retained
calibration telemetry is marked `is_maintenance`; latest-telemetry/prediction
paths exclude it. Build PASS; affected Device/MQTT gateway/Telemetry/Prediction
regression **129/129 PASS**. Docker access is denied, so the migration and
isolated MQTT/PostgreSQL E2E were not run. No database, queue, production
setting, commit or push changed.

Read-only follow-up found that the configured local endpoint does reach an
existing PostgreSQL 16 database, but it is populated (586 devices / 70,309
telemetry / 864 alerts) and reported from a container-network address behind
the loopback mapping. With no `pg_dump` and denied Docker access, safe fixture
ownership and a mandatory backup cannot be established. The migration and all
writes remain blocked.

## AQS-104 autonomous closeout verification — 2026-11-22

**Status: `AQS104_PARTIAL_ENVIRONMENT_BLOCKED`.** The frontend AQS-104 spec was
made rate-limit compliant: it no longer forges `X-Forwarded-For` and combines
the Admin alert/render check with logout/JWT-revocation, leaving exactly five
real Auth-controller requests for Admin, Manager, Farmer, Inactive and logout.
Fixture credentials are now required from `AQS104_FE_PASSWORD`; the manifest is
restricted to ignored `tmp/`; and `synchronize: true` requires an explicit
isolated-fixture opt-in in addition to its existing exact database/loopback
guard. `web/test-results/` is ignored.

Current evidence: Core build PASS and HTTP throttle regression 6/6 PASS;
Frontend build PASS (existing >500 KB advisory) and mocked browser regression
15/15 PASS; AI focused publisher/event-ID 13/13 PASS and full pytest 90/90
PASS. The dedicated runtime cannot currently be rerun: ports 4300, 4301,
56304, 56379 and 5674 have no listener and Docker config/engine access is
denied. No test attempted to create infrastructure, touch queues/DLQ, flush
Redis, modify databases, or alter production gates. Earlier real E2E results
remain historical evidence, not a result of this verification.

Publication: Core `feature/AQS-104_ai-risk-alerts-consumer@e140632` and AI
`feature/AQS-104_ai-risk-event-id@0516bc8` were normal-pushed and fetch-verified
against their respective `origin` refs. Frontend branch
`feature/AQS-104_manual-web-e2e@34633e6` was created from the observed `main`,
normal-pushed and fetch-verified. No matching GitHub Actions run was returned
for these three commit SHAs; this is not a CI pass. No PR or merge occurred.

## AQS-104 frontend runtime validation — 2026-11-21

**Status: `AQS104_FRONTEND_RUNTIME_E2E_BLOCKED_FIXTURE_AUTH_DATA`.** Source
audit confirms the intended live path is PostgreSQL `alert` → authenticated
Core `GET /alerts` (role-scoped) → portal normalization/hooks → `/alerts`.
The component can display AI-created `CRITICAL` entries with pond name, metric,
value, status, time and message; UI routes are available to Admin/Manager/Farmer
while AI trigger actions are Admin/Manager-only. The Core authorization policy
is server-side and is the source of truth.

Read-only inspection of the labelled AQS-104 database proved the browser test
cannot be made real safely: there is one inactive FARMER user, no Admin/Manager
and no farmer assignment. The JWT strategy rejects it before route access and
requires Redis validation. Creating/enabling fixture users or bypassing auth
would alter test data/security semantics, so neither was done. Existing mocked
Playwright browser regression **15/15 PASS (22.5s)** and frontend production
build PASS are retained as mock/build evidence only. Real backend+browser,
role-scope, API-rendered AI Alert, responsive/theme and console claims remain
blocked; no production AI or provider delivery changed.

## AQS-104 Python-to-Core real cross-service E2E — 2026-11-21

**Status: `AQS104_CROSS_SERVICE_E2E_PASS / PRODUCTION_AI_BLOCKED_PENDING_APPROVAL`.**
The new opt-in test `test/aqs104/python-publisher-cross-service.e2e-spec.ts`
uses the real AQS-104 Python publisher process, a UUID-named temporary topic
exchange/queue/DLQ, the NestJS consumer/service instantiated directly, and the
labelled RabbitMQ/PostgreSQL fixture. It proves a HIGH dissolved-oxygen test
event creates exactly one UUID-scoped `CREATED` receipt, one `CRITICAL` Alert
for pond `878b6ccb-1432-42af-b4e1-27151b87ec12`, and one outbox intent; the
same event ID is accepted as duplicate without extra effects. No AppModule,
outbox worker, Email/SMS/FCM provider or production gate was started/changed.

Fixture safety was read-verified before use: both named containers have
`project=aqs104-e2e`, healthy state, and loopback ports only. Final real E2E
is **8/8 PASS** (new cross-service plus the existing 7) in 5.65s; focused Core
AQS-104 regression is **31/31 PASS**. Post-run queue counts are unchanged for
the originals: main **0**, DLQ **3**, and the pre-existing isolated queue stays
at **1**. PostgreSQL retained rows now total **30 Alerts / 36 Receipts / 28
Outbox**; nothing was reset or deleted. This is integration acceptance, not a
production-AI approval or frontend acceptance.

## AQS-104 AI Publisher offline-timeout remediation — 2026-11-21

**Status: `AQS104_PARTIAL_WITH_EVIDENCE`.** The AI AQS-104 worktree
`feature/AQS-104_ai-risk-event-id@a11e0aa` now has uncommitted timeout-safety
changes only: `RabbitMQPublisher.connect()` shares one in-flight robust-connect
task, bounds the complete connect/channel/topology sequence with a two-second
application deadline, cancels and drains it on timeout, and closes partially
initialized resources. It logs a credential-free broker URL and returns
offline/fallback status rather than hanging. The underlying evidence is that
aio-pika robust retry treats the observed `TimeoutError` as retryable; its
per-call `timeout=2.0` did not bound the full factory loop. `fail_fast` is
already default and was not changed.

Validation: Python compilation PASS; publisher/event-ID suite **13/13 PASS in
18.44s**; full AI suite **90/90 PASS in 17.54s** using the functioning
`.venv-aqs101` (the named `.venv` has no executable base); isolated no-commit
AQS-102 + AQS-104 merge had no conflict and its focused compatibility suite
passed **35/35 in 8.87s**. Event-ID/routing/risk-level contract remains intact.
Docker CLI cannot access its config/engine named pipe in this session, so the
labelled `aqs104-e2e-*` fixture cannot be safely inspected; no real broker,
PostgreSQL, queue/DLQ, frontend, provider delivery or production gate changed.
No commit, push, merge, reset or cleanup was performed.

## AQS-104 RabbitMQ retry and reliability — 2026-11-21

**Status: `AQS104_E2E_CLEANUP_COMPLETE / PRODUCTION_AI_BLOCKED_PENDING_APPROVAL`.** Core branch `feature/AQS-104_ai-risk-alerts-consumer@1abfbaf` is normally pushed and now fixes the verified transient retry fault: `sendToQueue()` rewrote the retry delivery routing key to `ai_risk_alerts`, causing the consumer to DLQ it before its second service attempt. The consumer now uses a `ConfirmChannel`, mandatory topic republish to `shrimp.events` / `ai.risk.detected`, publisher-confirm timeout, exact-channel ACK/NACK, bounded retry/DLQ and reconnect scheduling. Invalid payloads are permanently DLQ'd without consuming retry budget. It remains disabled unless both the explicit consumer flag and `AI_PRODUCTION_INFERENCE_APPROVED=true` are set; neither production setting changed.

PostgreSQL is at-least-once/idempotent through `ai_risk_alert_receipt.event_id`; created alerts now also write a durable `ai_risk_notification_outbox` intent in the same transaction. The worker invokes the canonical dispatcher directly and Redis remains realtime fan-out, closing the persist-to-Pub/Sub loss window. The receipt migration is additive and rerunnable for existing TypeORM-created tables; the new outbox migration is additive. Focused Core suite is **35/35 PASS**, build PASS, lint PASS with 18 existing warnings, and real RabbitMQ/PostgreSQL E2E is **7/7 PASS** (HIGH/MEDIUM/LOW, concurrent duplicate, notification boundary stub, transient/exhausted/invalid, reconnect, ACK-crash redelivery). Provider delivery was deliberately stubbed; no Email/SMS/FCM was sent.

Safety note: the first shared-exchange E2E run copied seven test messages into the previously empty `ai_risk_alerts` queue. Direct AMQP inspection verified all seven without destructive action; after explicit user approval, each matching fingerprint was ACKed individually. Final verification is `ai_risk_alerts`: **0 ready / 0 consumers** and `ai_risk_alerts.dlq`: **3 ready / 0 consumers**. No queue was purged and no DLQ message was read, changed or deleted. The corrected suite uses a temporary exchange and leaves no temporary exchanges/queues or additional shared messages. External provider delivery remains intentionally stubbed and production approval is false, so full production success is not claimed. The AI event-ID branch remains published at `feature/AQS-104_ai-risk-event-id@a11e0aa`.

## AQS-103 async database health check — 2026-11-21

**Status: `AQS103_DEVELOPMENT_ACCEPTANCE_FULL` (local; not committed or pushed).** The AI Service branch `feature/AQS-103_async-database-health-check` was created from `origin/develop@e3363ee` and locally merged with the published AQS-102 branch to preserve the canonical/legacy payload compatibility and single-prefix route work. `GET /health` previously ran synchronous SQLAlchemy/psycopg connection/query work directly in its `async def`, which could block FastAPI's event loop. It now offloads the bounded synchronous probe to a worker thread, uses a 3-second default async response timeout, applies a 3-second driver connect timeout, and scopes a PostgreSQL statement timeout to the read-only health transaction. The response contract and HTTP status policy are unchanged. Regression: FastAPI pytest **111/111 PASS** (97 pre-existing/dependency warnings); AQS-103 concurrency coverage demonstrates `/openapi.json` under 100 ms while a controlled health probe waits 200 ms. Core and Frontend were audited read-only and require no changes: neither calls FastAPI `/health`. No production data, deployment, model/risk-rule setting, commit, or push changed. **`PRODUCTION_AI_BLOCKED_PENDING_APPROVAL` remains controlling.**

**RabbitMQ regression follow-up:** the unit test `test_rabbitmq_offline_graceful_degradation` formerly attempted a real localhost TCP connection and was therefore susceptible to platform-dependent robust-client timing. It now mocks only `aio_pika.connect_robust` to force a refused connection while executing the real publisher graceful-degradation code. Full pytest exited **0: 111/111 PASS in 13.65s** under a 120-second process guard; RabbitMQ module 5/5, AQS-103 6/6 and AQS-102 compatibility 22/22 all pass. The requested `.venv` cannot run because its Python 3.10 base executable is absent; the existing functional `.venv-aqs101` (Python 3.14.2) supplied the verification environment. No publisher production logic, external broker, Core/Frontend code, commit, push, or production approval changed.

## Three-repository audit and publication verification — 2026-11-20

**Status: `AQUASENSE_THREE_REPOSITORIES_PUSH_VERIFIED`.** A fresh audit created the readable pre-push snapshot `D:\Khóa Luận\Backups\AquaSense-PrePush-20261120-140048-311`, preserved all pre-existing work, fetched each target, and verified each remote SHA directly. Core AQS-102 has no new source/documentation commit to create: `feature/AQS-102_dual-compatibility-route-prefix` remains clean and identical to `origin` at `2f0d9f26b9b24890a316db3e41b43539dbf0b593` (`BACKEND_ALREADY_PUBLISHED_NO_CHANGE_REQUIRED`).

AI FastAPI source remained at published `a9c1b44450964f9c95f40b70727b6434ac7b1861`; its tracked handover was then committed and pushed fast-forward through `4a23e225e66ec9e683583b6eabe0aede66f15d15` to final `991bbf3b65daa421fff8c2d00411b6781d6495b3`. Frontend `main` advanced safely from `957160f8a197dfc61ab90a8dead226a16619ca95` to `2313ca4255e33207fbb66503523f684ce543e14a` (`fix(aqs-101): harden pond prediction UX`, 21 audited files). The Frontend commit provides the shared UUID guard, no-invalid-`/devices` request behavior, stale-state protection, verified pond-name/two-hour/fallback display and acceptance coverage; it continues to call Core, not FastAPI, directly. Its pre-existing `web/test-results/.last-run.json` remains untracked/local and hash-preserved.

Fresh evidence: Core regression **79/79**, actual Core-to-FastAPI transport **2/2**, build PASS, lint PASS with 19 existing warnings, owned PostgreSQL E2E **16/16** and fixture database/container/port cleanup; FastAPI pytest **105/105** (80 warnings) plus direct loopback HTTP acceptance PASS; Frontend production build PASS, lint **0 errors / 137 warnings**, Playwright **15/15**. Both new pushes were normal fast-forward pushes with direct local/remote SHA equality; no force push, PR merge, deployment, real database or approval-state change occurred. GitHub Actions was queried read-only and returned no workflow run matching the three target SHAs; this is **CI/CD: no run found**, not a CI pass. **`PRODUCTION_AI_BLOCKED_PENDING_APPROVAL` remains controlling.**

## AQS-102 full-stack branch integration and remote verification — 2026-11-20

**Status: `AQS102_FULL_STACK_DEVELOPMENT_COMPLETE_AND_PUSH_VERIFIED`.** Core target `feature/AQS-102_dual-compatibility-route-prefix` is pushed and verified at `2f0d9f26b9b24890a316db3e41b43539dbf0b593`. Because the already-published feature and `origin/develop` had diverged, integration used two normal merge commits—not rebase or force-push—so both remote AQS-102 history and the Core AQS-101 commits `682b5ce`/`943c0cc` are ancestors of the result.

Conflict resolution kept the canonical Core-to-FastAPI payload (`temperature`, `ph`, `dissolvedOxygen`), strict complete/fresh telemetry validation, risk-score/risk-level mapping, correlation/job attribution, and the closed-by-default `AI_PRODUCTION_INFERENCE_APPROVED` gate. Approval-off persists `HEURISTIC_RULE` without an outbound FastAPI request; the isolated transport test alone uses an approval mock. Core regression passed **79/79**, real loopback Core-to-FastAPI HTTP **2/2**, build PASS, lint PASS with 19 existing warnings, and disposable PostgreSQL E2E **16/16**. The tmpfs/loopback fixture database, container and port were all verified clean after execution.

AI target is separately pushed at `d0904933441e2712e4ad4ecf71f4a8651217c628`, with full pytest **105/105 PASS**. Frontend remains on `main`: it calls Core `/predictions/...`, not FastAPI, so AQS-102 required **no Frontend commit**. Its current working tree was preserved; build PASS, lint **0 errors / 137 warnings**, and Playwright **15/15 PASS**. Production status remains **`PRODUCTION_AI_BLOCKED_PENDING_APPROVAL`**.

## AQS-101 + AQS-102 final regression-blocker remediation — 2026-11-20

**Status: `AQS101_AQS102_FULL_REGRESSION_PASS`.** The final isolated verification removes the four identified regression blockers while retaining `AQS-101_DEVELOPMENT_ACCEPTANCE_FULL` and `AQS-102_DEVELOPMENT_ACCEPTANCE_FULL`. This is development and test evidence only. **`PRODUCTION_AI_BLOCKED_PENDING_APPROVAL` remains in force**: no model, risk rule, production inference approval, real database, deployed service, branch, commit or remote state was changed.

The portal lint gate is now **0 errors / 137 warnings** (exit 0). The 137 warnings are pre-existing debt and were not suppressed or mass-disabled. Frontend production build passed and the AQS acceptance suite passed **15/15** (the original 11 plus four UUID/name/switch regressions).

FastAPI full regression passed **105/105** in an isolated temporary directory. A narrowly scoped `AQUASENSE_HTTP_TEST_MODE=true` adapter is used only by test processes: it replaces Redis/RabbitMQ connections with in-memory no-op adapters, disables the database health probe, and exposes a test-only request counter. The normal application path is unchanged. Tests prove that the HTTP lifecycle makes no Redis, RabbitMQ or database connection attempt and that the comprehensive assessment route performs no cache write or alert publication.

The current canonical comprehensive-assessment endpoint is an explicitly documented, read-only development analysis and responds **HTTP 200** for valid input. It is neither the Core operational-prediction path nor a production AI/risk-rule approval. The earlier `503 RISK_RULES_PENDING_APPROVAL` record below describes a different historical service revision and is not the current endpoint behaviour.

Core verification passed: targeted prediction regression **67/67**, actual two-process loopback HTTP integration **2/2**, build PASS, lint PASS with 18 existing warnings, and disposable PostgreSQL persistence E2E **16/16 PASS**. The fixture ran on an owned loopback/tmpfs container, the test database was absent after the suite, and the owned container was removed.

## Pond UUID / forecast-card integrity follow-up — 2026-11-20

**Status: PASS; `AQS-101_DEVELOPMENT_ACCEPTANCE_FULL` is retained.** The observed `GET /devices?pondId=22222222-2222-2222-2222-222222222203` HTTP 400 is an invalid persisted seed identifier, not a relaxation required in the Core API. The fourth UUID group starts with `2`, which violates the RFC UUID variant; it is rejected by the current version-unspecified `@IsUUID()` in `FindDevicesQueryDto`. This is distinct from Core create/assignment DTOs, which explicitly require `@IsUUID('4')`; controller `ParseUUIDPipe` usage is also version-unspecified.

The portal now uses a single client-side predicate matching the `/devices` query contract. `getDevicesByPondId()`, `getSensorReadings()`, `getPondDashboard()` and Monitoring validate before any `/devices` request; an invalid ID produces an actionable message containing that exact pond code, never falls back to unfiltered devices, and is not presented as an empty device list. Monitoring, `usePond` and `useWaterQuality` clear prior-pond state and ignore cancelled/late responses, preventing an unhandled rejection or cross-pond data leak.

The source was traced, read-only, to `shrimp-infrastructure/postgres/init-scripts/02_seed_data.sql` line 40; the same invalid key is referenced by its seeded devices, thresholds, telemetry/alerts and prediction rows. No seed, persistence, foreign key or real database was changed. Remediate that dataset only in a separately approved infrastructure migration/seed change that updates its references atomically.

The AI analysis card derives a name only from the current verified `usePonds` result; its fallback keeps the pond code. Its stated horizon is now the actual client contract of **2 hours**, not `24–72` hours. `HEURISTIC_RULE` is explicitly marked as an unapproved heuristic fallback, not production AI. Evidence for this follow-up: Core device DTO test **14/14 PASS**; Core AQS-101 focused regression **53/53 PASS**; Core build PASS; Frontend production build PASS; the 11 existing mocked Playwright acceptances plus 4 UUID/name/race regressions **15/15 PASS**. Frontend lint remains unchanged at **9 errors / 137 warnings**; none is a new lint error from this work.

## AQS-101 final development-acceptance update — 2026-11-20

`AQS-101_DEVELOPMENT_ACCEPTANCE_FULL`. The repaired Core `ai-develop-v1` adapter, FastAPI strict request schema, telemetry freshness/failure policy, queue discard policy, frontend error/source display, and history-response race guard are locally implemented and verified. Core focused mapper/service/processor tests pass **53/53**; FastAPI full pytest passes **85/85** in a temporary isolated Python environment; Frontend Playwright API-mocked browser acceptance passes **11/11**; Core and Frontend production builds pass.

The guarded PostgreSQL persistence suite now passes **16/16, 0 SKIP, 0 FAIL** against its explicit disposable local fixture. Its sixteenth case sets NestJS `AI_PRODUCTION_INFERENCE_APPROVED=false`, proves FastAPI is not contacted, and verifies `HEURISTIC_RULE` persistence. The fixture database and disposable container were cleaned up after the run. No shared/production database was used. Core full `npm test` still has six unrelated functional-policy fixture failures; frontend lint has 9 errors/137 warnings. None was hidden or changed for AQS-101.

Production remains separate: **`PRODUCTION_AI_BLOCKED_PENDING_APPROVAL`**. `AI_PRODUCTION_INFERENCE_APPROVED=false` is retained; the AI `develop` endpoint's test-time HTTP 200 computation is not a model/risk/business approval. The feeding scaler version mismatch remains a separate known issue.

## AQS-101 remediation state — 2026-11-19 (historical, superseded)

`AQS-101_PARTIAL`. Core `feature/AQS-101_prediction-payload-mapping@5b6e6a0`, AI `develop@e3363ee`, and Frontend `main@957160f` now contain local, uncommitted AQS-101 remediation changes. Core emits only `ai-develop-v1` (`temperature`, `ph`, `dissolvedOxygen`, `salinity`, `turbidity`, `pondId`, source `timestamp`); FastAPI requires that complete schema and forbids legacy/unknown keys. Missing/invalid/future/stale telemetry returns structured `PREDICTION_TELEMETRY_*` 503 before FastAPI or persistence, including scheduled queue runs. Valid telemetry can use labelled `HEURISTIC_RULE` fallback when AI inference is not explicitly approved; it is never represented as an approved AI model.

Historical snapshot only: Core mapper/service/queue regression **53/53 PASS**, Nest build PASS, Core lint PASS (18 existing warnings), frontend production build PASS. Its then-blocked/16-skipped PostgreSQL and `.venv` statements are superseded by the final **16/16 E2E PASS** and **85/85 FastAPI PASS** above. Frontend lint remains 9 errors/137 warnings outside AQS-101. Model/risk approval remains pending; the current production status is `PRODUCTION_AI_BLOCKED_PENDING_APPROVAL`.

## AQS-101 controlling re-audit — 2026-11-19 (historical, superseded)

`AQS-101_REIMPLEMENTATION_REQUIRED` on current required source: Backend `feature/AQS-101_prediction-payload-mapping@5b6e6a0`, AI `develop@e3363ee`, Frontend `main@957160f`. Core emits strict `currentDO/currentPH/currentTemp` seven-field payload, while AI develop requires `temperature`/`ph` and expects `dissolvedOxygen`; an in-process AI TestClient returned 422 for the actual Core payload (missing `temperature`, `ph`) and 200 only for the AI-develop vocabulary. Do not use older AQS-101/AQS-102 acceptance history as proof of current cross-repository compatibility.

Core mapper/service/processor regression passed 44/44, build passed and lint passed with 18 existing warnings. AI focused current API suite passed 10/10, while full pytest collected 82 but did not yield a complete auditable result in this isolated-temp run. The isolated PostgreSQL E2E suite correctly skipped all 16 cases: no opt-in variables and no listener at `127.0.0.1:55432`; no DB write occurred. Frontend build passed, but lint has 9 existing errors/137 warnings. Existing frontend fallback labeling is partial only: transport errors are converted to an empty result and no stale telemetry warning is present. No source/model/rule/database/Git mutation was made.

## AQS-102 final Git audit — 2026-11-19

All three required repositories were fetched from `origin` and are at remote parity (`ahead/behind 0/0`). Backend is on `feature/AQS-102_dual-compatibility-route-prefix` at `1c00f3430a5db643a14bc1afd0928440c8919706`; its only AQS-102 commit adds queue `triggerSource` and `parentJobId` typing that is consumed by the prediction processor. AI is on the same branch at `93442559a075cd0c1b4222da5b2fd6f415a62364`; its canonical route/schema/approval-gate commit is already on `origin`. Frontend remains on `main` at `c0c1b22d24917e68201e36d36565d6f769d44461` and its two unstaged dashboard-card layout edits are not AQS-102 API integration work; its client calls Core `/predictions/...`, not FastAPI directly.

No new AQS-102 files were staged, committed or pushed. Existing AI local configuration, research/model, script, test and documentation changes, plus Frontend layout edits, were preserved. `git diff --check` passed in all three repositories; staged-change secret scan was not applicable because each index was empty. `PENDING_APPROVAL` for production model/risk rules and the FastAPI approval gate remains unchanged.

## AQS-102 final technical retest — 2026-11-19

**AQS-102 Technical Retest: PASS.** At local FastAPI `127.0.0.1:8002`, `/health` returned `200` / `ok`; the canonical `POST /api/v1/ai/water-quality/comprehensive-assessment` route was present and the duplicated `/api/v1/v1/...` route was absent. A valid seven-field payload reached `503 RISK_RULES_PENDING_APPROVAL`; `{}` returned `422`; an `unknownSensor` field returned `422 extra_forbidden`; and `currentDO: 99` returned `422` above the 15 mg/L schema maximum. Therefore **HTTP Contract, Route Prefix and Approval Gate are PASS**.

FastAPI full regression is **58/58 PASS** (`2 warnings`, `7.59s`) when rerun with isolated `TEMP`/`TMP` and `--basetemp`. The initial `55 passed, 3 errors` was an environment-only Windows Temp access failure (`PermissionError: [WinError 5]`); no source was changed. Comprehensive-assessment business inference remains **BLOCKED / PENDING_APPROVAL**. Do not represent this as production AI completion. The feeding scaler version mismatch remains a separate known issue.

## AQS-102 validator/route implementation — 2026-11-17

FastAPI now mounts `/api/v1/ai/water-quality/comprehensive-assessment` exactly once through a router prefix. It validates the existing seven-field `ForecastRequest`, appears at the canonical OpenAPI path and has no `/api/v1/v1/...` duplicate. Valid input returns the intentional `503 RISK_RULES_PENDING_APPROVAL` gate; it does not fabricate an assessment, `riskScore` or `riskLevel`. The stated legacy `currentDO/currentPH/currentTemp` names are already the canonical Core wire names, so no unapproved synonym alias was added. FastAPI focused/full tests pass 20/58; Core focused prediction regression passes 56, build/lint pass (18 existing lint warnings). Successful comprehensive assessment remains blocked pending approved business contract, model and ruleset.

Final HTTP acceptance at `127.0.0.1:8002` observed health 200/`ok`, canonical OpenAPI route present and duplicate route absent. Empty body returned 422; a complete valid `ForecastRequest` returned `503` with `detail.code = RISK_RULES_PENDING_APPROVAL`. Therefore technical implementation is PASS; business inference remains BLOCKED / `PENDING_APPROVAL`, not production-ready.

The verified AQS-102 FastAPI source/test dependency set is committed and pushed as `9344255` on `shrimp-ai-service` branch `feature/AQS-102_dual-compatibility-route-prefix`, tracking its `origin` branch. Local configuration, artifacts, data, docs and unrelated work remain uncommitted.

The matching Core feature branch now also contains `1c00f34`, which adds the typed prediction-queue `triggerSource` and `parentJobId` fields required by the already-implemented AQS-102 source/correlation flow. The one-file backend change passed the focused 56-test regression, build and lint before push.

## AQS-101 comment source tiếng Việt — 2026-11-17

Comment/JSDoc tiếng Anh trong các file AQS-101 liên quan đã được chuẩn hóa sang tiếng Việt, gồm `PredictionsService`, FastAPI mapper, PostgreSQL persistence E2E và comment cấu hình freshness. Đây là thay đổi tài liệu nội tuyến duy nhất: không đổi logic, API, schema, assertion hoặc fixture. Các thuật ngữ kỹ thuật cần thiết vẫn giữ nguyên. Core focused tests PASS **56/56**, build PASS và lint PASS với 18 cảnh báo có sẵn ngoài phạm vi; kết quả được ghi trong `TASK_HISTORY.md` và báo cáo nghiệm thu AQS-101.

## AQS-101 E2E freshness boundary correction — 2026-11-17 (historical, superseded by 16/16 rerun)

The prior dedicated-container run result **14 PASS / 1 FAIL / 1 SKIP** is historical. The single failure was a test-fixture clock race (`ageMs: -1`): the service sampled `now` before the async fixture created `new Date()`. The fixture now uses a synthetic timestamp one second in the past; production rejection of genuinely future telemetry is unchanged. Core focused regression is PASS 56/56, build/lint pass. The isolated 16-case rerun is BLOCKED in this Codex session because Docker API access is denied; no shared database or alternative port was used. Do not record 15 PASS / 1 SKIP until an authorized rerun completes.

## AQS-102 final E2E validation — 2026-11-17

Freshness/correlation final regression is PASS (56 focused Core tests); Core build is PASS. The PostgreSQL E2E suite is **BLOCKED**, not skipped or passed: it requires an explicit local-only dedicated fixture DB at loopback port 55432, but Docker API read-only inspection is currently denied and that port has no listener. No container, database, volume, migration or credential guessing was attempted. The configured 15-minute freshness value remains `REQUIRES_FIELD_VALIDATION` against real MQTT cadence and ingestion lag; production AI remains blocked.

## AQS-102 execution follow-up — 2026-11-17

**AQS-102 audit is closed as `AUDIT_COMPLETED / NO_REPRODUCIBLE_DEFECT`.** No validator alias or route was added because the alleged contract and router do not exist in the current source. The independently authorized follow-up hardened the actual prediction path: Core uses the newest valid device `recordedAt`, refuses missing/invalid/future/stale telemetry, and never persists a prediction or calls FastAPI from a stale/missing sample. `PREDICTION_TELEMETRY_MAX_AGE_MINUTES` defaults to the existing device stale timeout and is documented at 15 minutes.

Core now sends the telemetry source timestamp and `X-Request-ID` to FastAPI and writes structured source/correlation logs. Scheduled and manual-active BullMQ jobs carry source/parent-job context; deterministic telemetry-unavailable jobs are discarded without retry. The intentional FastAPI approval-gate 503 still produces one controlled `HEURISTIC_RULE` fallback for a fresh, valid request, so production AI remains blocked. See AQS-102 plan and the current test record.

## AQS-102 validator and route-prefix audit — 2026-11-17

The requested dual-compatibility and repeated-prefix defects are not confirmed in current source. `ForecastRequest` is the active Pydantic-v2 request schema and its canonical contract already uses `currentDO`, `currentPH`, `currentTemp` plus salinity, turbidity, pond ID and timezone-aware timestamp; `NestJSPredictRequest` is not found. FastAPI OpenAPI has only `/health`, `/api/research/forecast` and `/api/predict`; no `APIRouter`, `/v1/v1`, `predictions.py` or comprehensive-assessment route exists. AI contract tests passed 15/15 and Core AQS-101 mapper/service tests passed 40/40. A compatibility validator or route must not be added until an API owner identifies an actual legacy consumer and approves a versioned contract. See `AQS-102_AUDIT_AND_IMPLEMENTATION_PLAN.md`.

## AQS-101 controlling handover update — 2026-11-17

**AQS-101 technical scope is DONE (100%).** The canonical acceptance record is `AQS-101_FINAL_ACCEPTANCE_REPORT.md`. The Core request/response boundary, controlled heuristic fallback, isolated PostgreSQL persistence and portal-facing prediction workflow have evidence. On 2026-11-17, the supplied local run recorded Core HTTP 201 for Ao Nuôi Sú 03 with `LOW`, normalized score `0.1`/10% and `isFallback: true`; FastAPI returned the expected approval-gate 503. Its telemetry source was dated 2026-11-09 and is not realtime evidence.

Local FastAPI configuration was backed up and corrected from port 8000 to 8001 for the session, followed by a NestJS restart. This is a local development configuration record only. Production AI remains blocked: model and risk rules are pending approval; experimental validation lacks representative low-DO and rolling-origin evidence; feeding scaler compatibility and Firebase FCM initialization are unresolved. Keep `/api/predict` fail-closed and preserve Core `HEURISTIC_RULE` fallback.

## AQS-102 current update — 2026-11-16

The browser-facing prediction workflow is now verified in a disposable local environment. Real Chromium authenticated through the web UI, visited `/ai-analysis`, selected authorized ponds, called the Core trigger/history endpoints and captured sanitized network/UI evidence. A current FastAPI `503 RISK_RULES_PENDING_APPROVAL`, a schema-valid test-only success API, and an unavailable AI URL all produced the expected Core/UI behavior. The Core now scopes prediction latest/history/trigger through `PondsService`; a Manager’s foreign-pond history changed from reproduced `200` to verified `403`. The portal clearly labels heuristic fallback and no longer presents it as a successful AI calculation.

The production model/risk-rule gate is unchanged: `MODEL_ACCEPTANCE = PENDING_APPROVAL`, `RISK_RULE_APPROVAL = PENDING_APPROVAL`, and `PRODUCTION_AI = BLOCKED`. No production database, notification transport, deployment, commit or push was used.

## AQS-101L current update — 2026-11-16

AQS-101 original payload/mapping acceptance is **COMPLETED**. A disposable local PostgreSQL fixture on `127.0.0.1:55432` passed the guarded Core persistence suite (16/16); the exact fixture database was verified absent afterwards. Current-source FastAPI was run temporarily on loopback port 8001 for health/OpenAPI and 503/422 smoke evidence, then is to be stopped after acceptance cleanup. Full FastAPI regression is 53 passed, while Core mapper/service/processor is 42 passed; Core build/lint pass with the documented unrelated 18 warnings. This does not alter `MODEL_ACCEPTANCE = PENDING_APPROVAL`, `RISK_RULE_APPROVAL = PENDING_APPROVAL`, or `PRODUCTION_AI = BLOCKED`.

The temporary FastAPI process was stopped after testing. The dedicated E2E container/network remains running because its `--rm` cleanup would also auto-delete the anonymous PostgreSQL volume; no Docker volume deletion is permitted. Its fixture database has already been dropped.

## Workspace state (2026-11-16)

- Project root: `D:\Khóa Luận\Project`; five independent Git repositories.
- Core backend: branch `feature/P0-4_security-hardening`, `0f3fb3c`; before this documentation task the worktree was clean. This task added uncommitted `AGENTS.md` and `docs/system-knowledge/` only, by instruction not committed/pushed. Two local stashes exist (`codex-p0-4-consolidation` and an earlier P0-2 backup); do not drop/apply without inspection.
- AI: `main`, untracked `app/main.py` observed.
- Infrastructure, mobile and web: each has substantial uncommitted changes. Protect them; no reset/clean/branch switch without a preservation plan.
- Docker daemon was inaccessible; no live services confirmed. C: free space was ~8.47 GB at the AQS-101 audit.
- AQS-101 has uncommitted Core changes for strict prediction response mapping. Live FastAPI health/OpenAPI are available, but OpenAPI only exposes `/health` and `POST /api/predict` returns 404. AQS-101-COMPLETE is BLOCKED: no validated water-quality predictor, metadata, real labelled data, model metrics or PostgreSQL E2E evidence exists.
- AQS-101A recovered an isolated Python 3.14 AI environment and passed 19 pipeline tests. Read-only PostgreSQL audit found 70,297 telemetry rows across 44 ponds, but the water-quality target/horizon and acceptance criteria remain unapproved; no inference endpoint/model was added.
- AQS-101B/C trained a real experimental 2-hour DO/pH model and verified a FastAPI research endpoint. Production `/api/predict` intentionally returns `503 RISK_RULES_PENDING_APPROVAL`; Core regression confirms heuristic fallback. Risk rules, score formula, acceptance metrics, production rollout and persistence E2E remain PENDING_APPROVAL/NOT RUN.
- The web portal has uncommitted role-specific assignment empty states: Admin is not blocked by an empty operational dataset; Manager requires an assigned farm; Farmer requires an assigned pond. Web build/lint passed; visual E2E remains unverified.

## Last completed work

Backend security/farm workflow commit added telemetry idempotency/ACK, report device fault, farm manager revoke, user/farm scope and safe `.env.example` placeholders. Migrations `20261113_aquasense_telemetry_idempotency.sql` and `20261116_farm_manager_unassignment.sql` require controlled DB execution.

## Next actions

1. Synchronize web Staff form/API to manager `POST /users` contract with eligible `pondId` selection.
2. Run/apply migrations only after DB backup/change approval.
3. Restore Docker access, check compose health, then test MQTT/Redis/RabbitMQ/DB flows.
4. Reconcile AI plan with actual FastAPI implementation and implement/test missing contract only when requested.
5. Update/repair functional API fixtures for farm-scoped Manager behavior.
6. Publish and verify the FastAPI prediction schema, then run one controlled Core-to-AI integration test for AQS-101.

Never record or commit local secrets; do not delete stash, volumes, caches, or other repositories' uncommitted work without explicit authorization.

## AQS-101D current correction / handover

The earlier historical statements that FastAPI exposed only `/health` and returned 404 are obsolete. Current source and focused tests show experimental research forecast plus intentional operational 503. FastAPI now has an approval-gated risk engine but no approved production configuration. Keep Core unchanged and on `HEURISTIC_RULE` fallback; do not apply `threshold_config` as an AI risk policy, persist an `AI_MICROSERVICE` prediction, or emit an AI-driven alert until model acceptance, governed rule approval and isolated E2E persistence all pass.

Runtime caveat: the process currently bound to port 8000 still exposes only `/health`, so it is an older build rather than AQS-101D. The current source was verified only in a temporary port-8002 process which was stopped; Core-to-live-service E2E is not complete.

## AQS-101E/F/G current update

Read-only robustness evidence now confirms that the experimental artifact must not be promoted: valid forecast windows are temporally concentrated, the frozen holdout contains no low-DO target below 5 mg/L, and no eligible monthly rolling-origin fold exists. The policy review deliberately made no numeric runtime choice. An unknown-owner listener on port 8001 has source-compatible routes, but it is not deployment evidence; port 8000 remains old. Keep Core on strict 503-to-heuristic fallback. No schema/data/frontend change or persistence E2E occurred.

## AQS-101K current update

Payload/response mapping is now materially stronger: Core sends no incomplete FastAPI request and prevents invalid external scores/enums from becoming `AI_MICROSERVICE`. FastAPI contract checks cover non-finite JSON validation as 422 rather than 500. The original task cannot be accepted yet because the only missing required evidence—isolated PostgreSQL persistence—is unavailable: Docker is inaccessible and `localhost:5432` is refused. Use the guarded opt-in suite and `AQS-101_FINAL_ACCEPTANCE_REPORT.md` after infrastructure recovery. Model/rule approval and production prediction remain unchanged.
# AQS-104 frontend runtime E2E — 2026-11-21

**Current state: `AQS104_FRONTEND_REAL_E2E_PASS / PRODUCTION_AI_BLOCKED_PENDING_APPROVAL`.**
The dedicated labelled PostgreSQL/Redis fixture on loopback was healthy and the
sequential, no-mock Chromium suite passed 4/4: Admin live alerts, Manager
cross-farm denial by scoped empty result, Farmer assigned-pond/no-trigger UI,
inactive-account rejection, and Redis-backed logout-token revocation. Browser
assertions cover the real Pond A name, `AI predicted dissolved_oxygen`, value
2.80, CRITICAL/`Nguy hiểm`, ACTIVE/`Chưa xử lý`, persisted time, and AI alert
message. Production AI approval remains false and controlling.

Post-E2E checks: portal production build PASS; existing mocked portal suite
15/15 PASS; Core Auth/authorization/Alerts/AQS-104 focused suite 151/151 PASS.
No `aqs104_test`, existing RabbitMQ queue/DLQ, `.env`, provider, Git history,
commit, push or deployment changed. See `docs/AQS-104_DEVELOPMENT_HANDOVER.md`
for exact fixture labels, evidence paths, files, authorization matrix and the
required production-approval follow-up.

## AQS-202 — Live evidence update (2026-11-24)

- **Status:** `AQS202_PARTIAL_PASS`; do not promote to FULL_PASS.
- **Replayed, non-mutating evidence:** Core `localhost:3000` returned 401 for
  all four anonymous telemetry/prediction latest/history probes. Vite
  `127.0.0.1:5173` returned 200, and a fresh unauthenticated browser visit to
  `/devices` redirected to `/login`.
- **CORS observation:** the frontend-origin OPTIONS probe returned 204 and
  `Access-Control-Allow-Origin: *`. It is not evidence of an origin allow-list
  and needs a product-security decision if an allow-list is required.
- **User-supplied/manual evidence (not replayed here):** FARMER has no
  `/farms` request and sees only assigned ponds; cross-pond denial,
  Manager cross-farm denial, and JWT revocation were reported PASS. Preserve
  their classification as manual until reproducible sanitized logs are linked.
- **Outstanding:** live ADMIN/MANAGER browser checks, authenticated FARMER
  checks including unassigned state, repeatable JWT revocation/cross-farm
  HTTP evidence, and a no-loss AQS-201 integration of `TelemetryService`.
