# Task History

## AQS-203 — Alerts & Devices assignment-only RBAC

- **Date:** 2026-11-24
- **Repository / branch:** `shrimp-core-backend` /
  `feature/AQS-203_fix-alerts-devices-rbac` at
  `origin/develop@196c41874fdb07467832731490e3b83b3c5f6a37`.
- **Git safety:** Preserved the sole AQS-202 working edit in the stash named
  `aqs203-preflight-users-service-2026-11-24` before switching; its ordinal
  is deliberately not used as an identifier.
  The former AQS-203 worktree was clean/untracked-free and removed using Git.
- **Finding / fix:** Alerts and Devices used `pond.userId` as an alternative
  to FARMER assignment and Manager Farm ownership. Replaced every Alerts list
  and resolve path, and Devices list/detail/report/mutation path, with
  assignment-only FARMER scope and Farm-owner-only MANAGER scope. Role checks
  and repository behavior fail closed; pagination/count remain scoped at DB.
- **AQS-202 integration:** Audit found two issues: the stale UsersService mock
  behind 56/57 and missing Telemetry HTTP JWT/object-scope checks on the
  diverged AQS-203 branch. Restored only the Telemetry guard, authenticated
  device-to-pond authorization and matching tests; aligned the mock with the
  existing service contract. Wholesale cherry-pick was rejected because the
  AQS-202 base would overwrite later Predictions work.
- **Validation:** Alerts/Devices Vitest **36/36 PASS**; Ponds service/controller
  **64/64 PASS**; AQS-202 security audit **58/58 PASS**; cross-module security
  selection **280/280 PASS**; build PASS; lint exit 0 (17 existing warnings);
  diff check PASS.
- **Live status:** `LIVE_E2E_BLOCKED`; no listener was found and the safe GET
  probe could not connect. No application process, database, cache, broker,
  migration, commit, push or merge was changed.
- **Status:** `AQS203_PARTIAL_PASS`.

## AQS-202 — secure telemetry and predictions

- **Date:** 2026-11-22
- **Repository / branch:** `shrimp-core-backend` /
  `feature/AQS-202_secure-telemetry-predictions`, created from
  `origin/develop@e40b8e7`.
- **Finding and implementation:** Telemetry latest/history HTTP routes had
  Swagger bearer metadata but no actual JWT/object authorization. Added
  controller-level `JwtAuthGuard`, authenticated user extraction and a
  device-to-pond scope check before the telemetry repository is queried. The
  scope reuses the established `PondsService` Admin/Manager/Farmer policy.
  MQTT remained device/broker-authenticated and separate from the human JWT
  boundary.
- **Audit:** Predictions already enforce JWT/roles and pond scope before
  reading, calling AI or persisting a per-pond prediction. JWT strategy
  revocation/user-state controls were verified. Frontend uses its shared bearer
  client and preserves 403; AI is invoked only after Core scope validation.
  Neither adjacent repository needed a change.
- **Final audit/fix:** The JWT-suite failure was a stale fixture, not an
  AQS-202 production regression: `UsersController` delegates Manager profile
  access to `UsersService.assertManagerCanManageUser`, but the mock omitted
  it and claimed unrestricted Manager access. The fixture now follows that
  contract and has a foreign-scope Manager denial regression.
- **Validation:** JWT security audit **58/58 PASS**; expanded
  Telemetry/Predictions/Ponds/Users/lockout authorization regression
  **233/233 PASS**; `npm run build` PASS; `npm run lint` exit 0 with 18
  existing warnings outside AQS-202 edits. No live database, Redis, broker or
  AI request was made. HTTP E2E is BLOCKED because no owned isolated fixture
  exists; the populated project database was not used.
- **Status:** `AQS202_SECURITY_PASS`. Source and local documentation are
  intentionally uncommitted and unpushed at user direction.

## AQS-201 — Final local PostgreSQL/MQTT completion

- **Date:** 2026-11-22
- **Safety:** Created and verified a custom `pg_dump -Fc` archive outside Git
  before migration. The run used only UUID-labelled `AQS201_TEST_ONLY` rows;
  manifest-scoped cleanup returned all database counts to 586 devices, 70,309
  telemetry and 864 alerts.
- **Database:** Applied/re-ran additive `is_maintenance` column and supporting
  Timescale-compatible index after a zero-lock/session preflight and with a
  5-second lock timeout. Historical telemetry remains default false by design.
- **Acceptance:** Real PostgreSQL race and real local MQTT broker tests passed:
  MAINTENANCE survived, calibration rows were marked/excluded, 0 alerts were
  produced, and ACK/retry idempotency held. Build PASS; focused regression
  138/138 PASS; lint exit 0 with existing warnings.
- **Status:** `AQS201_BR03_PASS`; source/migration/test harness intentionally
  remain uncommitted and unpushed.

## AQS-201 — Local database completion audit

- **Date:** 2026-11-22
- **Read-only result:** The configured local endpoint reached PostgreSQL 16
  database `shrimp_local_db`, which contains 586 devices, 70,309 telemetry rows
  and 864 alerts and is container-network addressed behind loopback.
- **Safety decision:** `pg_dump` is absent and Docker config/engine access is
  denied; neither database ownership nor a mandatory backup can be proven. No
  migration, fixture, telemetry write, alert write, cleanup or broker action
  was performed.
- **Status:** PostgreSQL/MQTT E2E remains BLOCKED. Existing AQS-201 build and
  129/129 focused-regression evidence is retained; no commit or push occurred.


## AQS-104 — Frontend runtime E2E validation audit

- **Date:** 2026-11-21
- **Audit:** Traced AI-risk Alert persistence through Core `GET /alerts`, role predicates, frontend `alertsApi`, `useAlertsHistory`, `/alerts`, dashboard alert previews and `/ai-analysis`. The rendered alert uses `CRITICAL` danger styling, verified pond name, metric/value, status, formatted time and message; Core keeps authorization authoritative.
- **Fixture blocker:** Read-only query of the labelled AQS-104 database found one FARMER account only; it is inactive, and there are no Admin/Manager users or farmer assignments. The fail-closed JWT strategy also requires a live Redis check. Real role/browser access would require modifying fixture users or introducing an auth/API bypass, neither of which is allowed.
- **What ran:** Existing browser Playwright regression **15/15 PASS in 22.5s** and frontend production build PASS. The suite routes/intercepts its Core API; it is mock regression only, not a live Frontend → NestJS → PostgreSQL acceptance claim. It covers loading/empty/error/stale-response and prediction source states, but not real AQS-104 alert display, role scopes, responsive/theme or real-browser console cleanliness.
- **Safety:** No backend/frontend test server was pointed at production/shared data; no `.env`, database row, RabbitMQ queue/DLQ, approval gate, provider, source code, commit or push changed.
- **Status:** `AQS104_FRONTEND_RUNTIME_E2E_BLOCKED_FIXTURE_AUTH_DATA`. Required unblock is a dedicated disposable frontend-auth fixture with active Admin/Manager/Farmer identities, explicit pond/farm assignments, isolated Redis and a non-production backend endpoint.

## AQS-104 — Real Python Publisher cross-service E2E

- **Date:** 2026-11-21
- **Scope:** New opt-in Core E2E spec only. It starts direct consumer/service instances and the real AQS-104 Python publisher in a child process; it does not boot AppModule or the notification outbox worker.
- **Isolation:** Verified `aqs104-e2e-rabbitmq` and `aqs104-e2e-postgres` labels/health before writes. A UUID topic exchange, queue and DLQ are created per run. Credentials are read only from fixture-container configuration, used in process memory, and never logged. No `.env` changed.
- **Acceptance:** Python returns `True`; RabbitMQ delivers `ai.risk.detected`; NestJS ACKs; PostgreSQL writes one `CREATED` receipt, one `CRITICAL` Alert for the fixed E2E pond, and one outbox intent. Re-publishing the same event ID proves receipt/Alert/outbox idempotency and drains the temporary queue.
- **Validation:** Initial standalone run PASS. A combined run exposed a test-only total-Alert-count race while the existing suite ran in parallel; assertions were made UUID-scoped, not weakened. Final combined real E2E **8/8 PASS in 5.65s** (new test + existing 7). Focused consumer/service/validation/alerts regression **31/31 PASS**.
- **Safety evidence:** Read-only post-run checks: `ai_risk_alerts` 0 ready, original DLQ 3 ready, and pre-existing `aqs104.e2e.ef8dc8a1bf3b.queue` 1 ready. No shared message was consumed, ACKed, rejected or purged. Retained fixture totals: 30 Alerts / 36 Receipts / 28 Outbox. No DB reset/delete, provider delivery, commit, push or production configuration change.
- **Status:** `AQS104_CROSS_SERVICE_E2E_PASS / PRODUCTION_AI_BLOCKED_PENDING_APPROVAL`; frontend and real provider-delivery acceptance remain outside this execution.

## AQS-104 — AI Publisher robust-connect timeout remediation

- **Date:** 2026-11-21
- **Scope:** AI AQS-104 worktree only, plus no-commit temporary AQS-102 compatibility worktree and Core handover records. No Core, frontend, broker, database, migration, production configuration, provider or remote mutation.
- **Root cause:** `aio_pika.connect_robust()` retries a factory failure path containing the observed `TimeoutError`; its `timeout=2.0` applies below the complete robust retry loop. Thus the awaited publisher connect could exceed its intended bound even with the default `fail_fast=True`.
- **Implementation:** Publisher uses a lock-protected shared task and outer `asyncio.wait_for`; timeouts cancel and drain the task, while the attempt `finally` closes partial channel/connection resources. Concurrent callers share one attempt, recovery works on a later attempt, and log output omits AMQP credentials. Existing UUID event-ID, routing key, exchange and normalized risk-level contract are retained.
- **Validation:** compile PASS; AQS-104 publisher/event-ID tests **13/13 PASS (18.44s)**; full AI pytest **90/90 PASS (17.54s)** using `.venv-aqs101`; temporary no-commit AQS-102+AQS-104 integration merge was clean and focused compatibility/publisher tests **35/35 PASS (8.87s)**.
- **Blocker/limit:** Docker config/engine access was denied before any inspection, so no labelled AQS-104 RabbitMQ/PostgreSQL fixture, frontend E2E, DLQ operation or provider delivery was run. Final task status: `AQS104_PARTIAL_WITH_EVIDENCE`; `PRODUCTION_AI_BLOCKED_PENDING_APPROVAL` remains controlling.

## AQS-104 — RabbitMQ retry and reliability repair

- **Date:** 2026-11-21
- **Repository / branch:** `shrimp-core-backend` / `feature/AQS-104_ai-risk-alerts-consumer` (base AQS-104 commit `cfe865e`). AI source was not changed.
- **Root cause:** RabbitMQ E2E inspection, done with requeue-only DLQ reads, verified the hypothesized routing fault. `sendToQueue(ai_risk_alerts)` uses the default exchange; retry delivery then has routing key `ai_risk_alerts`, violates the strict `ai.risk.detected` check and reaches DLQ after only one service attempt. Two retained DLQ retry messages carried `x-ai-risk-retry: 1` and `Unexpected routing key`.
- **Implementation:** Replaced normal channel handoff with `ConfirmChannel` topic publish/mandatory return handling/confirm timeout; ACK occurs only after confirmed retry or DLQ handoff. Added reconnect scheduling, per-delivery channel safety, permanent validation classification and bounded retry behavior. Added `ai_risk_notification_outbox` written atomically with a created Alert and a worker that directly invokes the existing dispatcher, retaining Redis only for realtime fan-out. Added runnable receipt/outbox migrations and isolated real E2E suite.
- **Database / broker evidence:** Additive migrations pass live and rerun safely; an in-transaction simulated TypeORM-created receipt table received its missing CHECK, unique index and FK then rolled back. Baseline was 2 Alerts/3 receipts; UUID-scoped real E2E writes were retained (no reset), leaving 12 Alerts/15 receipts/10 outbox intents (8 PENDING, 2 DISPATCHED). The final corrected broker suite is 7/7 PASS and removes its temporary queues/exchange. Notification provider transports were stubbed and no real provider was invoked.
- **Quality:** focused consumer/service/validation/Alerts/listener **35/35 PASS**; build PASS; lint PASS with 18 existing warnings. Full Vitest retains only the documented six baseline failures (two MANAGER unlock, three functional lifecycle, one security audit); AQS-104 adds ten passing focused tests and introduces no failure.
- **Publication:** committed and normally pushed as `1abfbaf` (`fix(aqs-104): make RabbitMQ retry durable`); no force push, merge or deployment.
- **Environment exception:** the initial shared-exchange run put seven test messages in the previously empty `ai_risk_alerts` queue. `ai_risk_alerts.dlq` stays at its original three and was untouched. Safety controls refused ACK deletion because marker payloads were unavailable; require explicit authorization before cleaning exactly those seven messages. Status is therefore `AQS104_PARTIAL_ENVIRONMENT_CLEANUP_BLOCKED`, not technical full pass. Production approval remains false.
- **Cleanup evidence follow-up:** direct AMQP manual-ack inspection read all seven payloads without ACK/NACK/reject, then channel-close requeued them (verified 7 ready / 0 unacked). Every valid event carries `details.source=aqs104-e2e`; two UUIDs form the transient/exhaustion retry pairs (`x-ai-risk-retry=1`), one is the exact invalid test fixture, and the ACK-crash UUID matches a `CREATED` PostgreSQL receipt. Full per-message UUID/timestamp/header/SHA mapping is in `docs/AQS-104_DEVELOPMENT_HANDOVER.md`. Status becomes `AQS104_CLEANUP_AWAITING_USER_APPROVAL`; no queue message was deleted and the three DLQ messages remain intact.
- **Approved cleanup execution:** The user explicitly approved selective ACK. Immediately before action, the verified container/label and baseline were rechecked (main 7 ready / 0 unacked; DLQ 3 ready). The cleanup channel read all seven unacked, required an exact match on routing key, JSON content type, UUID, timestamp, E2E marker, metric, retry/handoff headers and SHA-256, then ACKed only the seven matching deliveries individually. Post-check: main **0 ready / 0 consumers**; DLQ **3 ready / 0 consumers**. No purge, bulk ACK, reject, DLQ read or PostgreSQL change occurred. Status: `AQS104_E2E_CLEANUP_COMPLETE / PRODUCTION_AI_BLOCKED_PENDING_APPROVAL`.

## AQS-104 — AI publisher event ID contract

- **Date:** 2026-11-21
- **Repository / branch:** `shrimp-ai-service` / `feature/AQS-104_ai-risk-event-id` from `origin/develop@e3363ee`.
- **Implementation:** `publish_risk_alert()` creates UUIDv4 `event_id` once for a new publish operation, validates/preserves caller-supplied IDs for retries, and includes the key in the payload. Event-boundary risk labels are normalized to Core's `LOW|MEDIUM|HIGH` contract while endpoint forecasting/scoring remains unchanged.
- **Validation:** dedicated event-ID and RabbitMQ publisher tests 8/8 PASS; full FastAPI pytest 85/85 PASS (95 dependency warnings, 17.10s).
- **Boundary:** AI production approval, broker topology, real broker/database E2E and production notifications remain unchanged/blocked.

- **Publication:** committed and normally pushed as `a11e0aa015d7c652914f98b333701e8aa485442e`; local and remote SHA match. Docker read-only diagnosis remains denied by the Docker config/context ACL and `docker_engine` named pipe, so no disposable E2E resources were created.

## AQS-104 — RabbitMQ AI risk alert consumer

- **Date:** 2026-11-21
- **Scope:** Core-only AMQP consumer; AI worktree was read-only and Frontend unchanged.
- **Implementation:** Added `amqplib` consumer/module with manual ACK, prefetch, bounded retry and durable DLQ; validates bounded snake_case events; maps MEDIUM/HIGH to WARNING/CRITICAL, persists a unique-event receipt with the alert transaction, and then reuses `AlertsService` to enter the existing notification pipeline.
- **Safety:** Consumer remains closed by default and additionally requires `AI_PRODUCTION_INFERENCE_APPROVED=true`. Legacy AI events lacking `event_id` cannot safely provide durable idempotency, so they are DLQ'd pending a separate AI publisher contract task.
- **Evidence:** Build PASS; focused suite 25/25 PASS; lint PASS with 18 existing warnings. Full Vitest completed: 776 PASS, 6 pre-existing failures, 6 skipped in 40.22s; none is AQS-104. RabbitMQ/PostgreSQL E2E BLOCKED: Docker API permission denied and no dedicated fixture; no database, broker, migration or provider was modified.

## AQS-103 — Async database health check

- **Date:** 2026-11-21
- **Repository / branch:** `shrimp-ai-service` / local `feature/AQS-103_async-database-health-check` (base `origin/develop@e3363ee`, local AQS-102 preservation merge `08245d5`).
- **Cause:** `/health` was async only at the endpoint layer; it called synchronous SQLAlchemy/psycopg database I/O inline, so slow database work could block the FastAPI event loop.
- **Implementation:** `check_db_connection_async()` wraps the existing sync probe with `asyncio.to_thread()` and `asyncio.wait_for()`. The engine receives a bounded connect timeout and the read-only health transaction receives `SET LOCAL statement_timeout`. Timeout and errors retain the existing `database` response shape without exposing a connection URL or credentials.
- **Tests:** FastAPI `pytest -q` **111/111 PASS** (97 warnings). New AQS-103 coverage validates online/offline/query-error and timeout status, response compatibility, HTTP-only isolation compatibility, and a 200 ms controlled probe while `/openapi.json` completes under 100 ms. Python compile and `git diff --check` PASS.
- **Compatibility:** Core does not call AI `/health`; the portal uses Core endpoints, not FastAPI health. No Core/Frontend code changed.
- **Boundary:** no commit, push, deployment, database mutation, model/risk-rule approval, or production-inference state change. `PRODUCTION_AI_BLOCKED_PENDING_APPROVAL` remains in force.

## AQS-103 — RabbitMQ offline-test stabilization and full regression

- **Date:** 2026-11-21
- **Finding:** The reported hanging test `tests/test_task_be05.py::test_rabbitmq_offline_graceful_degradation[asyncio]` could not be reproduced under an agent-owned 60-second guard (exit 0 in 9.87s), but it called the real TCP stack at `localhost:9999`. This makes a unit test host- and robust-reconnect-dependent.
- **Fix:** The test mocks the `aio_pika.connect_robust` I/O boundary to raise `ConnectionRefusedError`; it does not mock `RabbitMQPublisher.connect()`. Existing assertions remain and new call-count assertions prove both direct connection and publish fallback exercise the publisher's exception handling. No production RabbitMQ source changed.
- **Verification:** RabbitMQ module **5/5 PASS**; AQS-103 **6/6 PASS**; AQS-102 compatibility **22/22 PASS**; full pytest **111/111 PASS, 97 warnings, 13.65s, exit 0** with a 120-second process guard. The full log is in `tmp/aqs103-hang-audit-backup/full-pytest-after-rabbitmq-test-fix.log` outside the AI worktree.
- **Environment:** legacy `.venv` is nonfunctional because its Python 3.10 base is absent; all auditable tests used existing `.venv-aqs101` (Python 3.14.2). No broker, database, production policy, commit, or push was changed.

## Three-repository audit, regression and safe publication verification

- **Date:** 2026-11-20
- **Safety:** Before fetch/staging, created readable backup `D:\Khóa Luận\Backups\AquaSense-PrePush-20261120-140048-311` with identity, status, stash, staged/unstaged binary patch and untracked-file copies. The Frontend untracked files were hash-verified. No reset, clean, stash mutation, force push, branch switch of the Core AQS-101 worktree, model/risk-rule change, real database action or production deployment occurred.
- **Core:** Existing AQS-102 worktree and target remote both resolve to `2f0d9f26b9b24890a316db3e41b43539dbf0b593`; no new change was eligible, so `BACKEND_ALREADY_PUBLISHED_NO_CHANGE_REQUIRED`. Fresh verification: focused prediction/device regression **79/79**, actual loopback transport **2/2**, Nest build PASS, lint PASS with 19 warnings, and labelled loopback/tmpfs PostgreSQL E2E **16/16**. The owned fixture database, container and port were verified absent after the suite.
- **AI:** Target began at matching local/remote `a9c1b44450964f9c95f40b70727b6434ac7b1861`. Source did not change; only `docs/AQS-102_DEVELOPMENT_HANDOVER.md` was committed in two fast-forward commits (`4a23e225e66ec9e683583b6eabe0aede66f15d15`, final `991bbf3b65daa421fff8c2d00411b6781d6495b3`). Full pytest rerun: **105/105 PASS**. A temporary `AQUASENSE_HTTP_TEST_MODE=true` Uvicorn process verified health 200; canonical/legacy/equal-mixed predict requests 200; conflict/invalid 422; canonical assessment 200; doubled prefix 404, then stopped.
- **Frontend:** All 21 staged files were classified as AQS-101 prediction/pond-scope behavior, their acceptance tests, or corrections required to make the repository lint gate pass. Strong secret-pattern scan and cached `git diff --check` passed. `main` advanced from `957160f` to `2313ca4255e33207fbb66503523f684ce543e14a` through a normal fast-forward push. Build PASS, lint **0 errors / 137 warnings**, Playwright **15/15 PASS**. `web/test-results/.last-run.json` was intentionally excluded and preserved locally.
- **Status:** `AQUASENSE_THREE_REPOSITORIES_PUSH_VERIFIED`. GitHub Actions query is **NO_RUN_FOUND** for the exact target SHAs, distinct from local/remote push verification and not a CI pass. `PRODUCTION_AI_BLOCKED_PENDING_APPROVAL` is unchanged.

## AQS-102 full-stack integration, regression and push verification

- **Date:** 2026-11-20
- **Git strategy:** The published Core feature was two commits behind and two commits ahead of `origin/develop`; rewriting it would require a prohibited force-push. A protected worktree merged `origin/develop`, then the published AQS-101 branch, preserving all parents. Five prediction-boundary conflicts were resolved field-by-field: canonical request fields, structured freshness errors, approval-off fallback, correlation/job metadata and deterministic queue discard. Core normal push was fast-forward only and remote SHA equals `2f0d9f26b9b24890a316db3e41b43539dbf0b593`.
- **Verification:** Core focused AQS prediction/device tests **79/79**, real two-process transport **2/2**, build PASS, lint PASS (19 existing warnings), isolated PostgreSQL acceptance **16/16** with fixture database/container/port cleanup. AI FastAPI target `d0904933441e2712e4ad4ecf71f4a8651217c628` re-ran **105/105** pytest. Frontend build PASS, lint 0 errors/137 warnings and Playwright **15/15**; it requires no AQS-102 commit because it consumes Core endpoints only.
- **Security/safety:** Snapshot backups were verified before Git mutation. Commit-range whitespace and secret scans passed; `.env.example` sensitive keys contain marked placeholders, not credentials. No `.env`, model, scaler, dataset, production database, service, `main` or `develop` branch was changed. No force-push or PR merge occurred.
- **Status:** `AQS102_FULL_STACK_DEVELOPMENT_COMPLETE_AND_PUSH_VERIFIED`; **`PRODUCTION_AI_BLOCKED_PENDING_APPROVAL`** remains unchanged.

## AQS-101 + AQS-102 final regression-blocker remediation

- **Date:** 2026-11-20
- **Scope:** Resolved the four regression blockers named by the final audit: frontend lint errors, mock-only cross-service evidence, FastAPI external-infrastructure initialization under `TestClient`, and inconsistent comprehensive-assessment policy documentation. No production service, real database, model, risk rule, approval setting, branch, commit, push, merge or deployment was changed.
- **Frontend:** Corrected exactly nine ESLint errors without disabling rules or altering unrelated warnings. Final lint: **0 errors / 137 warnings** (exit 0); production build PASS; Playwright AQS acceptance **15/15 PASS**.
- **FastAPI lifecycle:** Added a test-only opt-in adapter selected only by `AQUASENSE_HTTP_TEST_MODE=true`. It provides in-memory/no-op Redis and RabbitMQ collaborators and disables the health database probe only inside isolated test processes. Full pytest: **105/105 PASS**. Dedicated lifecycle tests prove no external Redis, RabbitMQ or database initialization is attempted.
- **Cross-process boundary:** Added a Core Vitest integration that launches a separately owned loopback Uvicorn FastAPI process, invokes the real Core `PredictionsService` HTTP client, and proves both paths: approval flag false makes zero outbound calls and persists `HEURISTIC_RULE`; flag true makes one real HTTP request and maps the actual response. Result: **2/2 PASS**.
- **Assessment policy:** The current canonical FastAPI comprehensive-assessment route is a read-only development analysis returning HTTP 200 on valid input. It has no cache write or alert publication, is not invoked by the Core operational prediction flow, and does not confer production AI/model/risk-rule approval. Historical documentation claiming an approval-gate 503 is superseded for this current revision.
- **Persistence:** A separately labelled loopback/tmpfs PostgreSQL fixture executed **16/16 PASS**. Verification confirmed the fixture database was removed and the owned container was removed after testing.
- **Status:** `AQS101_AQS102_FULL_REGRESSION_PASS`; `AQS-101_DEVELOPMENT_ACCEPTANCE_FULL` and `AQS-102_DEVELOPMENT_ACCEPTANCE_FULL` retained; `PRODUCTION_AI_BLOCKED_PENDING_APPROVAL` retained.

## Pond UUID validation and forecast-card integrity follow-up

- **Date:** 2026-11-20
- **Scope:** Corrected portal request/state handling for a malformed persisted pond ID and corrected forecast-card attribution/text. No Core validation, infrastructure seed, database, model/risk rule, service process, commit, push, merge or deployment was changed.
- **Diagnosis:** `22222222-2222-2222-2222-222222222203` originates in `shrimp-infrastructure/postgres/init-scripts/02_seed_data.sql` and fails the UUID RFC variant check. `/devices?pondId` uses unversioned `@IsUUID()`; device create/assignment bodies use `@IsUUID('4')`. The malformed value is invalid under both contracts, so it must not be normalized or bypassed.
- **Portal behavior:** A shared query-contract guard blocks invalid IDs before `/devices`, including Monitoring, `getSensorReadings()` and `getPondDashboard()`. There is no all-device fallback or empty-list masking. The caller clears prior state, catches the failure and displays the exact pond ID. Request cancellation/version checks prevent stale device/sensor/pond state after switching ponds.
- **Forecast card:** Uses a name only from current `usePonds` data; the fallback preserves the code. The view now states the implemented two-hour horizon and labels `HEURISTIC_RULE` as an unapproved heuristic fallback.
- **Evidence:** Core device validation **14/14 PASS**; retained AQS-101 Core regression **53/53 PASS**; Core build PASS; Frontend production build PASS; baseline 11 Playwright acceptances plus 4 new UUID/name/race tests **15/15 PASS**. Frontend lint remains **9 errors / 137 warnings**, unchanged debt; the follow-up introduces no lint error.
- **Status:** PASS. `AQS-101_DEVELOPMENT_ACCEPTANCE_FULL` remains valid; `PRODUCTION_AI_BLOCKED_PENDING_APPROVAL` remains unchanged.

## AQS-101 — Final development acceptance execution

- **Date:** 2026-11-20
- **Scope:** Completed the current-source Core/AI/Frontend remediation verification without committing, pushing, changing a database, altering model/risk rules, or stopping a service. Source changes remain unstaged for the repository owner to review.
- **Core:** `ai-develop-v1` maps `currentDO/currentPH/currentTemp` one-way to `dissolvedOxygen/ph/temperature`; valid samples retain source `recordedAt`; missing, malformed, future, stale and out-of-range telemetry is rejected before outbound HTTP/persistence; valid unapproved inference remains labelled `HEURISTIC_RULE`.
- **AI:** Strict Core-wire contract tests **13/13 PASS**, API/lifespan tests **8/8 PASS**, and full regression **85/85 PASS in 17.85s** using a disposable Python 3.14 environment with isolated temporary paths. The project `.venv` was not repaired or modified.
- **Frontend:** Added protected history loading so an earlier pond request cannot overwrite a later selection. Reusable Playwright tests make only mocked Core requests and pass **11/11**; production build passes. Frontend lint remains **9 errors / 137 warnings** outside the AQS-101 edits.
- **Core quality:** Focused mapper/service/processor tests **53/53 PASS**, build PASS, lint PASS with 18 existing warnings. Full Core `npm test` retains six unrelated failures in user-management/unlock/security-audit fixture policy tests.
- **Persistence boundary:** The explicitly guarded isolated PostgreSQL E2E completed **16/16 PASS, 0 SKIP, 0 FAIL**. Case 16 now exercises the NestJS approval gate (`AI_PRODUCTION_INFERENCE_APPROVED=false`), proves no FastAPI request is received, and verifies persisted `isFallback=true` / `predictionSource=HEURISTIC_RULE`. The exact fixture database and disposable container were removed after completion; no shared/production database was used.
- **Status:** `AQS-101_DEVELOPMENT_ACCEPTANCE_FULL`. Production remains **`PRODUCTION_AI_BLOCKED_PENDING_APPROVAL`**; no model or risk-rule approval was granted.

## AQS-101 — Remediation and full integration attempt (historical, superseded)

- **Date:** 2026-11-19
- **Scope:** Implemented the smallest cross-repository contract, telemetry-validation, queue, frontend-state, test, and knowledge-base changes needed to remediate the controlling audit. No Git write action, database action, model/rule change, service stop, deployment, commit, or push was performed.
- **Core:** Added `ai-develop-v1` one-way request adapter; removed prediction sensor defaults; used real `recordedAt`; added finite/range/future/stale/malformed checks with 15-minute default; returns structured `PREDICTION_TELEMETRY_MISSING|INVALID|STALE|FUTURE`; scheduled jobs discard those non-retryable conditions. A valid but unapproved AI integration is labelled `HEURISTIC_RULE`.
- **AI:** Made the `/api/predict` request schema require all baseline telemetry, removed the fabricated DO default, and forbade legacy/unknown keys. Added contract tests for the Core wire vocabulary.
- **Frontend:** Preserves backend transport errors instead of showing an empty list; identifies stale/invalid telemetry separately from AI unavailability; displays the `HEURISTIC_RULE` source as an unapproved heuristic.
- **Tests:** Core mapper/service/processor 53/53 PASS; Core build PASS; Core lint PASS with 18 existing warnings; guarded persistence E2E 16 SKIP. Frontend build PASS; lint remains 9 errors/137 warnings outside scope. AI pytest blocked by its deleted Python 3.10 virtualenv base; syntax-only compilation PASS.
- **Status:** `AQS-101_PARTIAL`; approval and isolated persistence remain blockers.

## AQS-101 — Full audit and acceptance verification (historical, superseded)

- **Date:** 2026-11-19
- **Checked source:** Core `feature/AQS-101_prediction-payload-mapping@5b6e6a0`; AI `develop@e3363ee`; Frontend `main@957160f`. All indexes/worktrees were clean; no checkout, stash restoration, source/model/database change, commit or push occurred.
- **Finding:** Core builds the seven-field `current*` payload, but current AI develop requires `temperature` and `ph` and uses `dissolvedOxygen`. Direct FastAPI TestClient evidence: Core payload → 422 (missing `temperature`, `ph`); AI-develop vocabulary → 200. This is a current integration defect, not an approval-gate response.
- **Tests:** Core mapper/service/processor 44/44 PASS; build PASS; lint PASS with 18 existing warnings. AI current focused multi-parameter API suite 10/10 PASS (3 warnings); full pytest collected 82 but no completed auditable result was produced in that old isolated-temp attempt. PostgreSQL persistence was not accepted in that historical audit; it is superseded by the final **16/16 PASS** rerun. Frontend build PASS; lint FAIL with 9 errors/137 warnings outside AQS-101.
- **Status:** `AQS-101_REIMPLEMENTATION_REQUIRED`; remedy requires an owned versioned Core/AI request contract, removal of fabricated telemetry defaults, and a fresh isolated persistence acceptance run. Production AI approval remains separate and pending.

## AQS-102 — Final Git audit, commit and push verification

- **Date:** 2026-11-19
- **Repository audit:** Fetched `origin` for Backend, AI and Frontend. Each local target branch exactly matches its remote (`ahead/behind 0/0`): Backend `feature/AQS-102_dual-compatibility-route-prefix` = `1c00f3430a5db643a14bc1afd0928440c8919706`; AI same branch = `93442559a075cd0c1b4222da5b2fd6f415a62364`; Frontend `main` = `c0c1b22d24917e68201e36d36565d6f769d44461`.
- **Scope decision:** Backend has no new modification; existing `1c00f34` is the AQS-102 typed queue contract used by the prediction processor. AI has no new AQS-102 modification; `9344255` already contains the canonical one-prefix route, strict schema and fail-closed approval gate. Frontend's two unstaged changes only alter dashboard-card presentation and retain Core `/predictions/...` calls, so they are not staged, committed or pushed.
- **Safety and quality gates:** Empty index in every repository; no staged secret scan required. `git diff --check` passed for Backend, AI and Frontend. All unrelated AI local config/research/model/scripts/docs/tests and Frontend layout changes were preserved.
- **Status:** `NO_CHANGES_REQUIRED` for all repositories; no duplicate commit or push was created. Production AI and comprehensive-assessment business result remain `PENDING_APPROVAL` / blocked.

## AQS-102 — Final technical retest documentation

- **Date:** 2026-11-19
- **Scope:** Documentation-only retest record. No source, model, risk rule, database, service, commit or push change.
- **HTTP Contract / Route Prefix / Approval Gate:** **PASS.** FastAPI at `127.0.0.1:8002` returned health `200` / `ok`; canonical `POST /api/v1/ai/water-quality/comprehensive-assessment` exists; duplicated `/api/v1/v1/...` route is absent; valid seven-field input returned `503 RISK_RULES_PENDING_APPROVAL`; `{}` returned `422`; `unknownSensor` returned `422 extra_forbidden`; `currentDO: 99` returned `422` above the 15 mg/L schema limit.
- **Automated regression:** First `pytest` run was `55 passed, 3 errors` because Windows Temp access raised `PermissionError: [WinError 5]`. Isolating `TEMP`/`TMP` and using `--basetemp` produced **`58 passed, 2 warnings in 7.59s`**. Final FastAPI regression: **58/58 PASS**; no source workaround was made.
- **Status:** **AQS-102 Technical Retest = PASS.** Comprehensive-assessment business inference is **BLOCKED / PENDING_APPROVAL**; production AI is not complete. Feeding scaler version mismatch remains a separate known issue.

## AQS-102 — Dual-Compatibility Validator & Comprehensive Assessment Route implementation

- **Date:** 2026-11-17
- **Design:** Confirmed that the alleged legacy `currentDO/currentPH/currentTemp` and the current canonical Core-to-FastAPI names are identical. Retained one strict normalized `ForecastRequest` rather than inventing undocumented aliases. Added a single-prefix router for `/api/v1/ai/water-quality/comprehensive-assessment`.
- **Safety:** Valid request is validated then fail-closed with `503 RISK_RULES_PENDING_APPROVAL`; it cannot bypass approval or manufacture an assessment. Existing `/health`, `/api/predict` and `/api/research/forecast` remain unchanged.
- **Evidence:** FastAPI focused contract/route PASS 20; full pytest PASS 58 (2 dependency deprecation warnings); syntax compilation PASS; Core focused mapper/service/processor PASS 56; Core build PASS; lint PASS with 18 existing warnings.
- **Status:** `PARTIAL_ACCEPTANCE`. Canonical route/prefix and existing request vocabulary are verified; mixed-field conflict handling and successful assessment are not applicable/blocked until a distinct approved legacy vocabulary and a business/model/ruleset contract exist. No Docker, PostgreSQL, model artifact, commit, push or deploy change.

## AQS-102 — Final HTTP acceptance and documentation

- **Date:** 2026-11-17
- **HTTP evidence:** Local FastAPI `127.0.0.1:8002` returned health 200/`ok`; OpenAPI contained `/api/v1/ai/water-quality/comprehensive-assessment` and excluded `/api/v1/v1/ai/water-quality/comprehensive-assessment`; empty POST returned 422; complete valid request returned 503 body code `RISK_RULES_PENDING_APPROVAL`.
- **Acceptance:** validator/current payload, strict request schema, canonical route and single prefix are `PASS`. The observed 503 is the expected business approval gate after validation, not a route or validator defect.
- **Boundary:** comprehensive-assessment business inference remains `BLOCKED / PENDING_APPROVAL`; model/risk rules and production readiness were not changed.

## AQS-102 — Feature branch commit and push

- **Date:** 2026-11-17
- **Repository / branch:** `shrimp-ai-service`, `feature/AQS-102_dual-compatibility-route-prefix`.
- **Remote evidence:** commit `9344255` (`feat(aqs-102): add compatible prediction validation and versioned assessment route`) was pushed to `origin/feature/AQS-102_dual-compatibility-route-prefix` and upstream tracking was established.
- **Committed scope:** FastAPI entrypoint/router/schema/risk gate/forecaster-training dependencies plus focused contract/risk-rule tests and fixture; no config change, secret, `.env`, virtual environment, local docs, data or model artifact was staged.
- **Quality gate:** `git diff --cached --check` PASS; staged sensitive-pattern scan 0; full FastAPI pytest PASS 58/58 using an isolated pytest base temp directory.

## AQS-102 — Backend queue contract commit and push

- **Date:** 2026-11-17
- **Repository / branch:** `shrimp-core-backend`, `feature/AQS-102_dual-compatibility-route-prefix`.
- **Committed scope:** Only `src/common/queues/queue.constants.ts`: optional `triggerSource` and `parentJobId` complete the typed BullMQ prediction-job contract already consumed by the AQS-102 processor for source/correlation attribution.
- **Evidence:** Queue consumer/spec inspection; Core focused mapper/service/processor PASS 56/56; `npm run build` PASS; `npm run lint` PASS with 18 existing warnings; `git diff --check` PASS.
- **Remote evidence:** commit `1c00f34` (`fix(aqs-102): align backend prediction integration`) pushed to `origin/feature/AQS-102_dual-compatibility-route-prefix`. No docs, AGENTS, environment, database or unrelated file was staged.

## AQS-101 — Chuẩn hóa comment source sang tiếng Việt

- **Date:** 2026-11-17
- **Scope:** Chỉ chuyển ngữ comment/JSDoc trong các thành phần AQS-101 đã thay đổi: `PredictionsService`, mapper FastAPI, PostgreSQL persistence E2E và cấu hình freshness mẫu. Không đổi tên định danh, fixture, assertion, API, schema hoặc logic.
- **Result:** Đã chuẩn hóa 8 khối comment trong source/test và 1 comment cấu hình sang tiếng Việt; giữ nguyên các thuật ngữ kỹ thuật như `telemetry`, `timestamp`, `fallback`, `correlationId`, `PostgreSQL` và `FastAPI` khi phù hợp.
- **Regression:** Core focused mapper/service/processor PASS **56/56**; `npm run build` PASS; `npm run lint` PASS với 18 cảnh báo có sẵn ngoài phạm vi AQS-101.
- **Status:** COMPLETE; không commit, push hoặc deploy.

## AQS-101 — PostgreSQL E2E freshness time-boundary correction

- **Date:** 2026-11-17
- **Historical runtime result:** dedicated `aquasense-aqs101-postgres-e2e` run at loopback 55432: 14 PASS, 1 FAIL, 1 SKIP. The `DANGER/100 → HIGH/1` test failed before persistence with `ageMs: -1`.
- **Root cause and fix:** `now` is sampled before awaiting telemetry; the test fixture created `new Date()` after that point. Changed only the isolated fixture timestamp to `Date.now() - 1000ms`; validation still rejects actual future timestamps. No freshness threshold or production logic changed.
- **Regression:** Core focused mapper/service/processor PASS 56; build PASS; lint PASS with 18 existing warnings. The deterministic exact-15-minute boundary test remains present.
- **Rerun status:** BLOCKED in the Codex environment because Docker API access is denied. No 15 PASS / 1 SKIP result is claimed; no database/container/volume was changed.

## AQS-102 — Final E2E validation and regression

- **Date:** 2026-11-17
- **PostgreSQL isolation:** `BLOCKED`. The guarded suite requires explicit local-only host/port/user plus exact fixture database and verifies no existing fixture DB before it writes. Docker API inspection returned permission denied and loopback port 55432 had no listener; no unsafe container/database action was taken. Result: 0 run, 16 blocked.
- **Freshness matrix:** PASS, focused Core suite now 56 tests. Added coverage for future/missing/malformed timestamps, missing DO/pH/temperature, NaN/Infinity, config override and exact 15-minute boundary, in addition to stale persistence/HTTP prevention and queue discard.
- **Regression:** Core build PASS; prior unchanged AI full pytest remains PASS 53. Production approval gate remains unchanged.
- **Status:** Technical freshness/correlation acceptance PASS; isolated persistence rerun BLOCKED by infrastructure access. Field validation is required before changing the 15-minute default.

## AQS-102 execution follow-up — telemetry freshness and 503 traceability

- **Date:** 2026-11-17
- **Cause analysis:** Scheduled prediction runs every 30 minutes, expands one job per active pond and has two BullMQ attempts with a five-second backoff. `POST /predictions/pond/:pondId/trigger` runs directly; `/trigger-active` enqueues the active-pond sweep. The FastAPI 503 is the intentional risk-rule approval gate and is caught as fallback, so it does not itself cause BullMQ retry.
- **Implementation:** Removed default/fabricated prediction inputs. `PredictionsService` selects the newest device telemetry by `recordedAt`, requires all seven canonical FastAPI fields and rejects stale/future/missing/invalid data before HTTP or persistence. Default freshness is 15 minutes via `PREDICTION_TELEMETRY_MAX_AGE_MINUTES` / existing device timeout. Added `X-Request-ID`, structured logs and queue source/job correlation. Queue jobs rejected for unavailable telemetry are explicitly discarded without retry.
- **Files:** `.env.example`; queue constants; Predictions controller/service/processor; focused service/processor specs; isolated persistence fixture timestamp.
- **Validation:** Core mapper/service/processor PASS 47 tests; Core build PASS; lint PASS with 18 existing warnings; AI full pytest PASS 53 tests. Isolated persistence E2E remained opt-in and was skipped (16 tests), so no database was changed.
- **Status:** Freshness/correlation implementation COMPLETE. Research model and production AI approval remain separate, pending and blocked.

## AQS-102 — Dual-Compatibility Validator & FastAPI Route Prefix Fix audit

- **Date:** 2026-11-17
- **Scope:** Audit/reproduce/impact-plan/documentation only; no source, database, Docker, model, commit or push change.
- **Finding 1:** `NOT_REPRODUCED`. `ForecastRequest` is the active Pydantic 2 schema and `currentDO/currentPH/currentTemp` are its canonical Core fields, not legacy aliases. `NestJSPredictRequest` is absent. FastAPI contract suite passed 15 tests.
- **Finding 2:** `NOT_FOUND`. Current OpenAPI contains only `/health`, `/api/research/forecast`, `/api/predict`; no router/prefix composition, `predictions.py`, comprehensive-assessment endpoint, canonical `/v1` route or duplicated `/v1/v1` route exists.
- **Regression:** Core mapper/service targeted Vitest passed 40 tests. AQS-101 remains accepted and unchanged.
- **Status:** `PLANNED`; implementation requires approved compatibility/versioning scope and an identified consumer.

## AQS-101 — Complete documentation and project handover update

- **Date:** 2026-11-17 (covers the 2026-11-16 to 2026-11-17 work window)
- **Scope:** Consolidated AQS-101 payload/mapping, research/gate, isolated persistence and real local verification evidence into the existing knowledge base. Historical AQS-102 records were preserved; only their relevant browser evidence is referenced.
- **Verified delivery:** Core validates the complete FastAPI request before transport; maps `SAFE/WARNING/DANGER` and `0..100` to Core `LOW/MEDIUM/HIGH` and `0..1`; persists safe fallback on invalid response, timeout, transport failure, 422 and approval-gate 503. Isolated PostgreSQL E2E passed 16/16; FastAPI passed 53 tests; Core focused suite passed 42; Core build/lint passed; Chromium portal integration evidence is PASS.
- **Local run:** FastAPI local port was corrected 8000 → 8001 after backup; NestJS restarted. Ao Nuôi Sú 03 trigger returned 201 and showed `LOW`, `0.1`/10%, `isFallback: true`; FastAPI logged 503. Telemetry timestamp was 2026-11-09, not realtime.
- **Status:** **AQS-101 DONE — 100% technical scope.** `MODEL_ACCEPTANCE` and `RISK_RULE_APPROVAL` remain `PENDING_APPROVAL`; `PRODUCTION_AI = BLOCKED`.

## AQS-102 — Real frontend predictions integration and browser E2E

- **Date:** 2026-11-16
- **Scope:** React `/ai-analysis` route, authenticated Core predictions API and current FastAPI approval gate, all on disposable loopback infrastructure.
- **Bug fixed:** Prediction latest/history/trigger had no pond-scope check. Reproduced Manager A reading Manager B’s history returned 200; Core now delegates to `PondsService` and returns 403. The frontend now identifies `HEURISTIC_RULE` output as a fallback instead of a successful AI result.
- **Evidence:** Three Chromium runs passed: real FastAPI 503 fallback, test-only schema-valid success mapping (`SAFE/WARNING/DANGER → LOW/MEDIUM/HIGH`, 20/55/85%), and unavailable-AI fallback. Desktop/mobile, reload, one-request loading state, history and Manager isolation were covered. Generated evidence is in the frontend `reports/aqs-102-browser-e2e/` folder.
- **Status:** FRONTEND_API_INTEGRATION = PASS; REAL_BROWSER_E2E = PASS; RESEARCH_AI_FORECAST = NOT_TESTED; PRODUCTION_AI = BLOCKED/PENDING_APPROVAL.

## AQS-101L — PostgreSQL recovery, persistence E2E and final acceptance

- **Date:** 2026-11-16
- **Infrastructure:** Docker Engine was verified without changing its ACL, WSL configuration, volumes or VHDX. A dedicated ephemeral PostgreSQL container/network bound only to `127.0.0.1:55432` was created with no volume mount. The guarded suite verified local-only endpoint, exact absent fixture name and `CREATEDB`, then removed its fixture database after completion.
- **Evidence:** Core PostgreSQL persistence E2E passed 16/16, including five valid mapping/normalization boundaries; invalid enum/score/type/missing-field, malformed JSON, connection-refusal and timeout fallback; fixture 422/503; and a real current-source FastAPI 503 approval-gate fallback. FastAPI full regression passed 53 tests; Core targeted prediction regression passed 42; Core build and lint passed (18 pre-existing warnings).
- **Status:** AQS-101 ORIGINAL TASK = COMPLETED. MODEL_ACCEPTANCE = PENDING_APPROVAL; RISK_RULE_APPROVAL = PENDING_APPROVAL; PRODUCTION_AI = BLOCKED. No production data/model/rule/artifact, alert delivery, commit, push or deployment changed.

## AQS-101K — Final integration, persistence and acceptance

- **Date:** 2026-11-16
- **Implementation:** Core now validates the full FastAPI request schema before transport. Missing/non-finite/out-of-range sensor fields do not produce an outbound incomplete payload; they use the controlled heuristic fallback. Added score/enum/boundary regressions and an opt-in disposable PostgreSQL persistence suite with a local HTTP fixture.
- **Bug fixed:** FastAPI validation responses for `NaN`, `Infinity` and a timezone-free timestamp could become server errors because error details were not JSON-safe. A request-validation handler now returns 422 safely without altering model/rule approval.
- **Evidence:** Core targeted prediction suite passed 42 tests; FastAPI isolated contract suite passed 15; Core build/lint and web build passed. Live port-8001 complete request returned 503 approval-gate and missing salinity returned 422.
- **Blocker:** PostgreSQL/Redis are offline and Docker daemon access is denied. The dedicated database E2E suite is correctly skipped; no persistence, alert or production E2E result is claimed.
- **Status:** AQS-101 ORIGINAL TASK = PARTIAL / E2E_BLOCKED; MODEL_APPROVAL = PENDING_APPROVAL; PRODUCTION_AI = BLOCKED.

## AQS-101E/F/G — Robustness, risk policy and runtime alignment

- **Date:** 2026-11-16
- **Scope:** Read-only AI data/model robustness evidence, policy-approval preparation and runtime inspection. Core source, DTOs, entities, migrations, database, frontend and deployment were not changed.
- **Evidence:** The frozen model has insufficient held-out low-DO and multi-period evidence. FastAPI remains intentionally gated; a port-8001 contract-compatible listener is not owned deployment evidence, while port 8000 is an old `/health`-only listener.
- **Compatibility:** The existing strict Core response mapper and non-success fallback remain appropriate. No `AI_MICROSERVICE` persistence, alert side effect or Core trigger was exercised.
- **Status:** TECHNICAL_IMPLEMENTATION = PARTIAL; MODEL_VALIDATION = INSUFFICIENT_LOW_DO_AND_TEMPORAL_COVERAGE; RISK_POLICY_APPROVAL = PENDING_APPROVAL; PRODUCTION_READINESS = BLOCKED.

## AQS-101D — Risk engine compatibility and acceptance evidence

- **Date:** 2026-11-16
- **Scope:** FastAPI versioned-rule/approval controls and read-only artifact reassessment; Core source, schema, migrations, database and frontend were not changed.
- **Discovery:** Core has active pond alert configurations (DO aliases, pH) and separate fallback constants, but neither includes version, approval status, score formula or shared forecast semantics. They are documented as existing implementation, not approved rules.
- **Compatibility:** FastAPI holds production at `503 RISK_RULES_PENDING_APPROVAL`; Core's strict non-success fallback remains the appropriate route. The future success contract preserves `SAFE|WARNING|DANGER` / 0–100 mapping.
- **Status:** RISK_ENGINE = technical PASS; MODEL_ACCEPTANCE = PENDING_APPROVAL; RISK_RULE_APPROVAL = PENDING_APPROVAL; PRODUCTION_PREDICTION = BLOCKED; AQS-101 = PARTIAL. No persistence E2E, commit or push.

## AQS-101B/C — Research forecast and production prediction gate

- **Date:** 2026-11-16
- **Scope:** FastAPI experimental forecast + Core 503 fallback regression; no frontend, DB mutation, production rollout, commit or push.
- **Evidence:** FastAPI model trained/evaluated on real telemetry and served research inference in development; `/api/predict` returns structured 503 due unapproved risk rules. Core targeted prediction suite passed 15 tests, including 503 → `HEURISTIC_RULE` and valid enum/score assertions.
- **Status:** RESEARCH = TECHNICALLY_VERIFIED; PRODUCTION = PENDING_APPROVAL; no persistence E2E by design.

## AQS-101-COMPLETE — FastAPI prediction integration verification

- **Date:** 2026-11-16
- **Status:** BLOCKED.
- **Evidence:** FastAPI `/health` and `/openapi.json` returned 200; OpenAPI contained only `/health`; `POST /api/predict` returned 404. The only artifact is a scikit-learn 1.5.1 seven-feature feeding `StandardScaler`, not a predictor; no metadata, labelled water-quality data or model metrics exist.
- **Safety outcome:** No artificial predictor, endpoint response, artifact replacement, production database action, commit or push was performed.
- **Required unblock:** a versioned water-quality predictor with provenance, feature/target definition, time-blocked validation metrics and an executable runtime, followed by real HTTP and PostgreSQL persistence tests.

## WEB-20261116-2 — Equal dashboard side-card heights

- **Date:** 2026-11-16
- **Scope:** `Smart Shrimp Farm/web` dashboard layout only.
- **Implementation:** The AI prediction and pond-alert cards now occupy one desktop grid column spanning both adjacent rows and divide that column equally with `flex: 1`; card content remains scrollable. Mobile retains natural vertical flow.
- **Validation:** `npm run build` and `npm run lint` passed; Vite reported the existing large-bundle advisory. No browser E2E was run.
- **Status:** COMPLETE.

## WEB-20261116 — Role-specific unassigned access states

- **Date:** 2026-11-16
- **Scope:** `Smart Shrimp Farm/web` presentation and assignment gate only; no backend, database, AI, environment or permission policy modified.
- **Implementation:** Replaced the shared unassigned modal with an inline, role-specific state. Manager is unassigned when no farm is returned and is directed to an Admin; Farmer is unassigned when no pond is returned and is directed to the farm Manager. Admin remains able to open the dashboard when no farm/pond exists and receives actions for farm/pond setup.
- **Contact design:** No fabricated hotline/email is displayed. The state identifies the responsible role and the precise assignment request, with a retry action after that person completes the assignment.
- **Validation:** `npm run build` and `npm run lint` in `web` passed. No browser E2E was run.
- **Status:** COMPLETE (implementation/build); visual/runtime verification remains pending.

## AQS-101 — Standardize AI prediction payload and response mapping

- **Date:** 2026-11-16
- **Scope:** Core prediction integration only; no FastAPI, frontend, DB schema, migration, environment or other repository changed.
- **Implementation:** Added a typed request/response adapter. It emits optional salinity/turbidity only when present in telemetry; accepts only `SAFE|WARNING|DANGER` and a finite 0–100 score, then maps to Core risk values/0–1. Invalid response, HTTP failure, timeout and transport failure fall back to the existing heuristic.
- **Contract evidence:** The local FastAPI source exposes only `GET /health`; `http://127.0.0.1:8000/openapi.json` refused connection. Therefore request-field compatibility and end-to-end execution remain unverified.
- **Validation:** Targeted prediction mapper/service/processor Vitest suites passed (14 tests); `npm run build` passed; `npm run lint` passed with pre-existing warnings. Full `npm test` exposed four unrelated existing-policy fixture failures (three functional API, one security audit); the prediction tests passed.
- **Status:** PARTIAL — Core boundary protection is implemented; the owned FastAPI prediction contract and live E2E test are outstanding.

## DOC-20261116 — Complete system functionality documentation

- **Date:** 2026-11-16
- **Scope:** Documentation and root workspace guidance only; no business logic, migrations, or runtime configuration modified.
- **Evidence reviewed:** repository layout, Git state, readmes/AGENTS, core controllers/entities/modules, clients' routes/navigation/services, AI source, Compose, migrations, CI and test inventory.
- **Output:** this knowledge base and `shrimp-core-backend/AGENTS.md`.
- **Validation:** link/file existence review; no heavy runtime test run due documentation-only scope, dirty multi-repo worktrees, Docker access denied and low C: disk.
- **Status:** COMPLETE (documentation task); runtime functionality remains largely IMPLEMENTED / UNVERIFIED.

## Prior implementation context reconstructed

`0f3fb3c` on `feature/P0-4_security-hardening` consolidated backend security/farm/telemetry/device work. Source and earlier task logs show core build passed and two focused suites passed; a functional suite had three old-policy fixture failures. Treat this as documented/partially verified until rerun on current worktree.
# AQS-104 — Final frontend real-browser E2E and handover

- **Date:** 2026-11-21
- **Status:** `AQS104_FRONTEND_REAL_E2E_PASS / PRODUCTION_AI_BLOCKED_PENDING_APPROVAL`.
- **Real runtime evidence:** dedicated labelled loopback PostgreSQL/Redis fixture;
  NestJS real authentication/API and React Chromium E2E, no mocks. Combined
  `aqs104-real.spec.mjs` passed **4/4** sequentially. It verified Admin alert
  rendering, Manager Farm-B exclusion including modified direct request,
  Farmer assigned-pond/no-trigger UI, inactive 401, and logout → Redis
  revocation → old access token 401.
- **Displayed field proof:** Pond A, `AI predicted dissolved_oxygen`, 2.80,
  CRITICAL/`Nguy hiểm`, ACTIVE/`Chưa xử lý`, timestamp and persisted AI message
  are asserted in browser and confirmed read-only against the isolated fixture.
- **Regression:** Frontend build PASS; existing mock portal Playwright **15/15**;
  focused Core Auth/authorization/Alerts/AQS-104 **151/151**.
- **Safety:** `aqs104_test` and pre-existing RabbitMQ messages untouched; no
  queue operation, provider delivery, production inference, `.env` mutation,
  commit/push/reset/clean. Fixture containers remain labelled and isolated.
- **Files:** added Core fixture harnesses; added Frontend real Playwright
  config/spec; corrected frontend Alert title mapping to retain metricName with
  the AI message. Existing unrelated untracked files were preserved.
- **Remaining limit:** this is development/fixture evidence only. Production
  deployment remains blocked pending model/risk-rule/business approval and a
  separately approved production readiness exercise.

## AQS-104 — Autonomous closeout safety verification

- **Date:** 2026-11-22
- **Change:** Removed the untrusted `X-Forwarded-For` test workaround. The
  browser suite now uses the first Admin session for the real logout/revocation
  check, keeps all five Auth-controller calls inside the documented limit, and
  keeps the Manager/Farmer/Inactive UI flows real. Added `web/test-results/` to
  Frontend ignore rules.
- **Fixture protection:** The Core auth-fixture seed requires a password from
  `AQS104_FE_PASSWORD`, confines its manifest to ignored `tmp/`, and requires
  explicit `AQS104_FE_ALLOW_SCHEMA_SYNC=true` before its existing guarded
  isolated schema synchronization can run.
- **Validation:** Core build PASS; HTTP throttle 6/6 PASS; syntax checks PASS;
  Frontend build PASS with its existing chunk warning; mocked Playwright 15/15
  PASS; AI publisher/event-ID 13/13 PASS and full pytest 90/90 PASS.
- **Blocked evidence:** No ports for the designated Backend/Frontend/Postgres/
  Redis/RabbitMQ fixture were listening and Docker config/engine access was
  denied. Consequently the changed real AQS-104 browser/cross-service suites
  were not rerun; no shared service or data was substituted.
- **Publication:** Normal pushes and direct fetch/SHA equality were verified
  for Core `e140632`, AI `0516bc8`, and Frontend `34633e6` on their required
  AQS-104 branches. GitHub Actions returned no matching run for these SHAs;
  that is recorded as CI/CD **no run found**, not a successful CI result.

## AQS-201 — Preserve MAINTENANCE during MQTT telemetry (BR-03)

- **Date:** 2026-11-22
- **Cause:** Telemetry processing used an initial Device-status snapshot for
  both liveness writes and threshold evaluation, leaving a TOCTOU window with
  an operator maintenance transition. Retained calibration rows also lacked a
  durable context marker for AI input selection.
- **Implementation:** Added a short Device-row lock for persistence and for
  threshold decision, `is_maintenance` telemetry context, a rerunnable
  additive migration, and Prediction guards for both the marker and current
  device maintenance status.
- **Regression:** Core build PASS; affected Device/MQTT gateway/Telemetry/
  Prediction suite **129/129 PASS**, including pH/DO/temperature calibration,
  MQTT ACK/duplicate, buffered input, normal liveness/alerts, race and AI
  exclusion coverage.
- **Boundary:** Docker config/engine access is denied, so no migration or
  MQTT/PostgreSQL E2E was executed. No commit or push was made.

## AQS-202 — Real Web UI & API security E2E attempt

- **Date:** 2026-11-23
- **Status:** `AQS202_WEB_E2E_PARTIAL`.
- **Runtime safety outcome:** No Backend, Vite, PostgreSQL, Redis, MQTT, or
  designated-fixture listener was present. Docker configuration/engine access
  was denied. The known project database is shared/populated and no owned
  TEST_ONLY Admin/Manager/Farmer, Farm-A/Farm-B and device/pond fixture was
  available. No browser/API request, test identity, token, Redis key, DB row,
  queue message, screenshot, trace, video, migration, configuration change,
  commit, push, or merge was created.
- **Regression:** Playwright Chromium 1.55.0 is installed; the current Core
  security selection passed **313/313** across 11 Vitest files; `npm run
  build` and `git diff --check` passed. This is in-process/unit/build evidence
  only, not real browser/API verification.
- **Remaining blocker:** provide an explicitly owned loopback fixture with
  verified TEST_ONLY Admin, Manager, Farmer, Farm A/B, ponds/devices and
  Redis-backed JWT revocation, then run the no-mock browser/HTTP matrix.

## Web RBAC — FARMER Devices farm-directory request

- **Date:** 2026-11-24
- **Scope:** Frontend role-aware farm-filter loading, a browser regression,
  and read-only Backend RBAC verification. No Backend authorization policy,
  database, migration, runtime configuration, commit, push or merge changed.
- **Root cause:** Devices called `GET /farms?limit=100` unconditionally;
  Backend correctly returns 403 because Farms readers are ADMIN/MANAGER only.
- **Implementation:** FARMER never calls the farm directory. Device filter
  options are de-duplicated from `farmId` values in already scoped ponds,
  without hardcoded IDs or placeholder Farm records. ADMIN/MANAGER behavior is
  retained. Removed one unused type import in the pre-existing dirty Staff
  refactor solely to restore the required typecheck gate.
- **Validation:** lint 0 errors / 140 existing warnings; typecheck + Vite
  production build PASS; Vite/Chromium controlled-API regression **19/19**;
  Backend Farms/Ponds/Devices RBAC Vitest **56/56 PASS**.
- **Limit:** direct live Backend/DB/Redis UI validation remains blocked because
  no safe runtime fixture/listener exists. Browser test evidence is mock API
  verification, not production or live authorization acceptance.

## AQS-202 — Release acceptance revalidation

- **Date:** 2026-11-24
- **Status:** `AQS202_PARTIAL_PASS`; `FULL_PASS` is explicitly not claimed.
- **Evidence:** Core AQS-202 security selection **313/313 PASS**, Core build
  PASS and lint exit 0 (18 existing warnings); Frontend lint 0 errors / 139
  existing warnings, typecheck + production build PASS, Vite/Chromium
  controlled-API regression **19/19 PASS**.
- **Security scope:** regression covers JWT/revocation fail-closed behavior,
  Manager/Farmer cross-scope denial, telemetry authorization-before-query and
  FARMER no-`/farms` browser behavior. It is not direct HTTP confirmation.
- **Runtime safety:** no listener was available. AppModule startup would attach
  to DB/Redis/BullMQ/Timescale/MQTT/workers and default background scheduling,
  so it was not started against shared configuration. No data or infrastructure
  was changed.
- **Integration:** AQS-201/AQS-202 `TelemetryService` overlap has no textual
  merge-tree marker but requires deliberate preservation of both authorization
  and maintenance behavior. No merge was attempted.

## AQS-202 — live acceptance evidence reconciliation (2026-11-24)

- Rechecked Git state without altering dirty worktrees. Backend remains on
  `feature/AQS-202_secure-telemetry-predictions`; Frontend remains on
  `feature/AQS-104_manual-web-e2e`. No reset, clean, stash, commit, push,
  merge, migration or data operation occurred.
- Replayed safe anonymous live HTTP checks: four protected telemetry/prediction
  latest/history endpoints returned 401. The live Vite root returned 200 and
  `/devices` redirected an unauthenticated browser to `/login`.
- Recorded CORS preflight as observed (204 and wildcard ACAO), not as a policy
  PASS. Did not use or create credentials, and therefore did not replay role
  data/scope, revocation or logout flows.
- Preserved reported FARMER no-`/farms`, Farmer/Manager scope and JWT
  revocation findings as manual evidence only. Final state remains
  `AQS202_PARTIAL_PASS` pending reproducible role logs and AQS-201 integration
  work.

## AQS-203 — final source regression and frontend recheck

- **Date:** 2026-11-24
- **Status:** `AQS203_PARTIAL_PASS / SOURCE_TEST_PASS`.
- **Core evidence:** AQS-202 audit plus Alerts, Devices, Ponds, Telemetry,
  Predictions and Users-unlock selected suite passed **357/357**; one
  database integration suite was intentionally skipped. Nest build, lint
  (17 existing warnings) and whitespace checks passed.
- **Test repair:** the old `assertManagerCanManageUser` fixtures omitted the
  service's existing pond/Farm Manager-scope repositories. Fixtures were made
  fail-closed; production authorization was not relaxed. `all-entities` is
  opt-in only for an explicitly named loopback database after an attempted
  default run showed it writes through `AppModule` and the local schema is
  stale for `ai_prediction.prediction_type`.
- **Web evidence:** lint exited 0 (139 existing warnings), TypeScript/Vite
  build passed, and controlled-API Playwright passed **19/19**. It is browser
  mock evidence, not direct Core integration.
- **Boundary:** full default Core integration suites and live HTTP remain
  `BLOCKED` without an owned DB/Redis fixture. No backend startup, migration,
  seed, database, Redis, MQTT, RabbitMQ, commit, push or merge occurred in
  this validation record.
