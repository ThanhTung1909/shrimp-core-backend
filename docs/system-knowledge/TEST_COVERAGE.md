# Test Coverage and Verification

## AQS-203 Alerts & Devices RBAC — 2026-11-24

| Command / check | Result | Scope / limitation |
|---|---|---|
| `npm exec vitest run src/modules/alerts/alerts.service.spec.ts src/modules/devices/devices.service.spec.ts` | **PASS, 36/36** | Assignment-only FARMER list/detail/resolve/fault behavior; legacy-owner denial; revoke invalidation; Manager Farm-only scope; Admin continuity; filters/pagination/count query construction. |
| `npm exec vitest run src/modules/ponds/ponds.service.spec.ts src/modules/ponds/ponds.controller.spec.ts` | **PASS, 64/64** | Ponds RBAC regression. |
| `npm run build` | **PASS** | Nest TypeScript build. |
| `npm run lint` | **PASS** | Exit 0, 17 existing warnings and no errors. |
| `git diff --check` | **PASS** | No whitespace errors. |
| `npm exec vitest run test/security-audit.spec.ts` | **PASS, 58/58** | Stale UsersService test double aligned with the existing Manager farm-scope contract; foreign-scope denial retained. |
| Cross-module RBAC/security Vitest selection | **PASS, 280/280** | Alerts, Devices, Ponds, Telemetry controller/service/integration and Predictions controller/service/processor/mapper. Telemetry guard and device-to-pond authorization were restored selectively from AQS-202. |
| Read-only live preflight | **LIVE_E2E_BLOCKED** | No listener on Core, Vite, PostgreSQL, Redis or RabbitMQ candidate ports. GET `/alerts` could not connect; no service was started. |

The AQS-202 branch was not wholesale cherry-picked: it predates the current
Predictions integration and would overwrite later work. This is source/in-process evidence only. It is not authenticated HTTP E2E
evidence for a deployed AQS-203 runtime.

## AQS-202 release acceptance revalidation — 2026-11-24

| Command / check | Result | Scope / limitation |
|---|---|---|
| Core AQS-202 security Vitest selection | **PASS, 313/313** | 11 files covering telemetry authorization order, pond/prediction scope, JWT/revocation and Manager/Farmer authorization. In-process regression, not live HTTP. |
| Core `npm run build` / `npm run lint` | **PASS** | Lint exits 0 with 18 existing warnings. |
| Frontend `npm run lint` | **PASS** | 0 errors / 139 existing warnings. |
| Frontend `npm run build` | **PASS** | Typecheck and Vite production build passed; existing >500 kB chunk advisory only. |
| Frontend Vite/Chromium suite | **PASS, 19/19** | Controlled Core responses; validates FARMER no `/farms`, role scope UI, loading/empty/error behavior. Not a live API claim. |
| Runtime preflight / background audit | **BLOCKED** | No listeners. App startup would initialize DB/Redis/BullMQ/Timescale/MQTT/workers and default schedulers, so no shared runtime was started. |
| AQS-201 compatibility read-only merge-tree | **PARTIAL** | No textual conflict marker; overlapping TelemetryService changes still require deliberate integration and retention of both security/maintenance paths. |

Final release classification is **`AQS202_PARTIAL_PASS`**: source and
controlled-browser quality gates pass; required live HTTP JWT, revocation and
cross-pond authorization E2E cannot be claimed without an owned fixture.

## Web RBAC — FARMER `/devices` farm-directory request — 2026-11-24

| Command / check | Result | Scope / limitation |
|---|---|---|
| Frontend `npm run lint` | **PASS** | 0 errors / 140 pre-existing warnings. |
| Frontend `npm run build` | **PASS** | Typecheck and Vite production bundle passed; existing >500 kB advisory only. |
| Frontend `npm run test:e2e:aqs101` | **PASS, 19/19** | Vite/Chromium browser regression with controlled Core responses. Added FARMER no-`/farms`, unassigned, Monitoring/AI and ADMIN/MANAGER Devices cases. |
| Backend Farms/Ponds/Devices Vitest | **PASS, 56/56** | Controller/service role-scope regression; no database runtime used. |
| Live Browser/API | **BLOCKED** | No safe Backend/PostgreSQL/Redis fixture/listener. Mock browser evidence must not be read as live authorization acceptance. |

The regression asserts that FARMER never requests `/farms`, derives filters
only from scoped ponds, and sees the unassigned state without a farm request.
ADMIN and MANAGER still request their permitted `/farms?limit=100` filter data.

## AQS-202 real Web UI & API security E2E attempt — 2026-11-23

| Command / check | Result | Scope / limitation |
|---|---|---|
| Runtime ports | **BLOCKED** | No listener found for Backend, Vite, PostgreSQL, Redis, MQTT, or the known fixture ports. |
| Docker fixture inspection | **BLOCKED** | Docker config/engine access was denied; no substitute stack was started. |
| Playwright Chromium availability | **PASS** | `npx playwright --version` reported 1.55.0; no browser was launched because no safe app/API runtime existed. |
| AQS-202 security Vitest selection | **PASS, 313/313** | 11 files: `security-audit`, Telemetry service/controller, Ponds service/controller, Predictions service/processor/mapper, and lockout authorization/recovery. Unit/in-process only; not HTTP E2E. |
| Core `npm run build` | **PASS** | Current AQS-202 worktree compiled. |
| `git diff --check` | **PASS** | No whitespace errors in the pre-existing AQS-202 source diff. |

No authentication, authorization, logout/revocation, cross-pond IDOR, UI, API,
trace, screenshot, or video case is claimed as real E2E evidence. The safe
shared-data boundary was retained; result is `AQS202_WEB_E2E_PARTIAL`.

## Three-repository audit rerun — 2026-11-20

| Command / check | Result | Scope / limitation |
|---|---|---|
| Core focused mapper/service/processor/device Vitest | **PASS, 79/79** | Canonical mapping, response/risk conversion, ownership/freshness paths, correlation, queue behavior and approval-off fallback. |
| Core real Core-to-FastAPI transport | **PASS, 2/2** | Separate loopback Uvicorn process; false approval makes no outbound call and saves `HEURISTIC_RULE`; isolated approved-test config makes one real request. |
| Core build / lint | **PASS** | Nest build passed; oxlint exits 0 with 19 existing warnings. |
| Core PostgreSQL persistence E2E | **PASS, 16/16** | Explicit loopback `127.0.0.1:55434`, named/labelled tmpfs fixture only; test database, owned container and port all cleaned. |
| FastAPI full pytest | **PASS, 105/105** | Isolated `TEMP`/`TMP`/`--basetemp`; 80 warnings including known serialized feeding-scaler/XGBoost compatibility and dependency deprecations. |
| FastAPI live HTTP acceptance | **PASS** | `/health` 200; canonical/legacy/equal-mixed `/api/predict` 200; conflicting/invalid values 422; canonical assessment 200; doubled `/api/v1/v1/...` route 404. Test-mode process stopped after check. |
| Frontend production build / lint | **PASS** | Output directed outside the worktree; Vite has a non-blocking chunk advisory, ESLint exits 0 with 137 existing warnings. |
| Frontend AQS Playwright | **PASS, 15/15** | Mocked Core browser acceptance covers fallback/source, error/loading/history race, invalid UUID no-request, valid pond request, device race, verified pond name and two-hour copy. |
| Git quality | **PASS** | `git diff --check` for commit candidates; strong secret-pattern scans found no credential-shaped values; remote SHA matched local after every required push. |
| GitHub Actions query | **NO RUN FOUND** | GitHub CLI queried each exact target SHA/branch read-only; absence of a matching run is not represented as a CI pass. |

The live assessment route is a read-only development contract and does not approve production model inference or risk rules. `PRODUCTION_AI_BLOCKED_PENDING_APPROVAL` remains in force.

## AQS-102 final full-stack branch verification — 2026-11-20

| Command / check | Result | Scope |
|---|---|---|
| Core mapper/service/processor/device regression | **PASS, 79/79** | Canonical Core request fields, legacy-compatibility boundary, telemetry freshness, approval-off fallback, response mapping and queue behavior. |
| Core actual loopback HTTP integration | **PASS, 2/2** | Separate Node/Vitest and Uvicorn processes: approval-off makes no request; isolated approval mock maps one real FastAPI request. |
| Core build / lint | **PASS** | Build passed; lint has 19 existing warnings and no errors. |
| Core disposable PostgreSQL E2E | **PASS, 16/16** | Loopback/tmpfs fixture only; database dropped and owned container/port removed after suite. |
| FastAPI full pytest | **PASS, 105/105** | Two non-overlapping groups (74 + 31), isolated `TEMP`/`TMP`/`--basetemp`; lifecycle makes no production infrastructure connection. |
| Frontend build / lint | **PASS** | Vite build passed; ESLint exits 0 with 137 existing warnings. |
| Frontend Playwright Edge | **PASS, 15/15** | Output held outside repository; Core API contract, fallback/source, pond switch and two-hour display cases. |

All checks used the final Core `2f0d9f2` integration code or the unchanged, verified AI/Frontend target code. The suite does not grant production AI/model/risk-rule approval.

## AQS-101 + AQS-102 final blocker verification — 2026-11-20

| Command / check | Result | Scope / limitation |
|---|---|---|
| Frontend `npm run lint` | **PASS, 0 errors / 137 warnings** | Nine blocking errors were corrected. The 137 warnings remain visible pre-existing debt; no broad lint disable was used. |
| Frontend `npm run build` | **PASS** | TypeScript and production Vite build. Existing chunk-size advisory remains non-blocking. |
| Frontend AQS Playwright | **PASS, 15/15** | Retains 11 baseline acceptances and four UUID/name/switch regressions. |
| FastAPI targeted lifecycle/route/BE01 pytest | **PASS, 31/31** | Uses only a temporary test directory and test-only no-op Redis/RabbitMQ/database adapters. |
| FastAPI full pytest | **PASS, 105/105** | `--basetemp`/`TEMP`/`TMP` isolated. 79 recorded warnings are existing dependency/model compatibility warnings, including the feeding-scaler version mismatch. |
| FastAPI external-dependency guard | **PASS** | Patched Redis ping, RabbitMQ connect and database health check raise if called; `TestClient` lifecycle and prediction request remain successful. |
| Core prediction focused regression | **PASS, 67/67** | Mapper, service, queue processor and device validation coverage. |
| Core real two-process HTTP integration | **PASS, 2/2** | Node/Vitest executes actual `PredictionsService`; a separately spawned loopback Uvicorn process receives real HTTP. Covers approval-off zero-call/`HEURISTIC_RULE` and approved-test-config one-call/mapping paths. |
| Core build / lint | **PASS** | Build passed; lint passed with 18 pre-existing warnings. |
| Core disposable PostgreSQL E2E | **PASS, 16/16** | Owned loopback/tmpfs fixture only; fixture database absent after suite and owned container removed. |
| `git diff --check` | **PASS** | Performed after final documentation update in each repository. |

The comprehensive-assessment endpoint tested above is a read-only development endpoint with valid-input HTTP 200. It is deliberately not a claim of production AI approval or a substitute for the Core operational approval gate.

## Pond UUID / forecast-card follow-up — 2026-11-20

| Command / check | Result | Scope / limitation |
|---|---|---|
| Core `devices.validation.spec.ts` | **PASS, 14/14** | Confirms version-unspecified `/devices?pondId` `@IsUUID()` accepts a valid v1/v4 UUID but rejects the malformed seed value; create/assignment v4-only DTOs reject v1. |
| Core AQS-101 mapper/service/processor Vitest | **PASS, 53/53** | Re-run confirms the portal-related work did not invalidate the approved Core prediction boundary. |
| Core `npm run build` | **PASS** | NestJS compilation. |
| Frontend `npm run build` | **PASS** | TypeScript and production Vite build; existing large-chunk advisory only. |
| Frontend AQS-101 Playwright | **PASS, 15/15** | Retains the 11 baseline mocked acceptances and adds four tests for invalid-ID no-request/error handling, valid `/devices` requests, switch/late-response isolation and verified forecast name/two-hour/fallback text. |
| Frontend `npm run lint` | **FAIL, 9 errors / 137 warnings** | Unchanged repository-wide debt; no lint error was introduced by this follow-up. |

The browser tests mock Core and prove the invalid identifier never issues `/devices`; no service, database or infrastructure seed was modified during this verification.

## AQS-101 development-acceptance evidence — 2026-11-20

| Command / check | Result | Scope / limitation |
|---|---|---|
| Core prediction mapper/service/processor Vitest | **PASS, 53/53** | `ai-develop-v1` request mapping, strict response mapping, telemetry missing/invalid/future/stale paths, fallback policy and queue discard behavior. |
| Core `npm run build` | **PASS** | Current AQS-101 Core worktree. |
| Core `npm run lint` | **PASS, 18 warnings** | Warnings are pre-existing outside the AQS-101 scope. |
| Core full `npm test` | **FAIL, 6 unrelated tests** | Functional users/unlock/security-audit fixture-policy failures; AQS-101 focused regression is unaffected and no unrelated test/code was changed. |
| Guarded Core PostgreSQL E2E | **PASS, 16/16; 0 SKIP; 0 FAIL** | Local disposable fixture only; persistence, mapping/fallback and cleanup assertions pass. Fixture database and disposable container were removed after the run. |
| PostgreSQL E2E case 16: NestJS approval gate | **PASS** | `AI_PRODUCTION_INFERENCE_APPROVED=false` prevents the outbound FastAPI call; test asserts the fixture receives no request and the saved row is `isFallback=true`, `predictionSource=HEURISTIC_RULE`. |
| FastAPI Core-wire contract tests | **PASS, 13/13** | Required `temperature`, `ph`, `dissolvedOxygen`, `salinity`, `turbidity`; missing/legacy/unknown keys rejected. |
| FastAPI API/lifespan tests | **PASS, 8/8** | `/api/predict`, feeding, and soft-sensor endpoint coverage in a temporary test environment. |
| FastAPI full pytest | **PASS, 85/85, 71 warnings, 17.85s** | Isolated `TEMP`/`TMP` and `--basetemp`; temporary Python 3.14 dependencies only. Warnings include serialized scaler/runtime version mismatch. |
| Frontend `npm run build` | **PASS** | Production build; Vite reports the existing large-chunk advisory. |
| Frontend AQS-101 Playwright | **PASS, 11/11** | Browser tests use fake authentication and fully mocked Core responses; covers source/error/empty/loading/race behavior without external writes. |
| Frontend `npm run lint` | **FAIL, 9 errors / 137 warnings** | Existing repository-wide lint debt outside the AQS-101 files. |
| `git diff --check` | **PASS** | Checked worktrees; line-ending notices are not whitespace errors. |

No test result above approves production model inference, risk rules, model artifacts, or a real operational database integration.

## AQS-101 remediation verification — 2026-11-19 (historical, superseded)

| Command / check | Result | Scope |
|---|---|---|
| `npm exec vitest run src/modules/predictions/contracts/ai-prediction.mapper.spec.ts src/modules/predictions/predictions.service.spec.ts src/modules/predictions/processors/prediction.processor.spec.ts` | **PASS, 53/53** | `ai-develop-v1` vocabulary, response mapping, no fake telemetry, source-time freshness, structured errors, heuristic metadata, manual trigger and scheduled queue discard. |
| `npm run build` (Core) | **PASS** | NestJS type/build validation after remediation. |
| `npm run lint` (Core) | **PASS**, 18 warnings | Warnings pre-exist outside AQS-101. |
| `npm run test:e2e -- test/aqs-101-prediction-persistence.e2e-spec.ts` | **SKIP, 16** | Correct guarded skip: no explicit isolated PostgreSQL configuration/fixture. |
| `python -B -c ... compile(...)` (AI changed files) | **PASS** | Python syntax only; not a runtime/schema test. |
| AI focused/full pytest | **BLOCKED** | `.venv` targets missing Python 3.10; available Python 3.14 has no project dependencies. |
| `npm run build` (Frontend) | **PASS** | TypeScript and production Vite build after error-state/fallback labelling changes. |
| `npm run lint` (Frontend) | **FAIL, 9 errors / 137 warnings** | Existing repository lint debt, including unrelated dashboard utility errors. |

No full cross-service/browser/DB E2E claim is valid from this run.

## AQS-101 full re-audit — 2026-11-19 (historical, superseded)

| Command / check | Result | Scope |
|---|---|---|
| Core mapper/service/processor Vitest | PASS, 44/44 | Mapper enum/score validation, service fallback and prediction queue behavior on `5b6e6a0` |
| Core `npm run build` | PASS | Current AQS-101 backend branch |
| Core `npm run lint` | PASS | 18 existing warnings |
| AI `.venv` `pytest tests/test_multi_param_water_quality.py -q` | PASS, 10/10 | Current `develop` API vocabulary and multi-parameter endpoint, 3 warnings |
| AI full pytest with isolated `AquaSense-TestTemp` | INDETERMINATE | 82 tests collected; no completed result/JUnit artifact, so not claimed PASS |
| Core guarded PostgreSQL E2E | SKIPPED, 16 | Required local-only opt-in variables unset; 127.0.0.1:55432 has no listener; no DB write |
| Frontend `npm run build` | PASS | Current `main`; chunk-size advisory only |
| Frontend `npm run lint` | FAIL, 9 errors / 137 warnings | Existing repository-wide failures; not remediated in this audit |
| Current-source Core payload against AI develop TestClient | FAIL, 422 | AI reports missing required `temperature` and `ph`; proves request contract mismatch |

## AQS-102 final technical retest — 2026-11-19

| Command / check | Result | Scope |
|---|---|---|
| FastAPI HTTP acceptance at `127.0.0.1:8002` | PASS | `/health` → `200` / `status: ok`; canonical POST route exists; doubled `/api/v1/v1/...` route absent |
| Valid seven-field comprehensive-assessment payload | PASS (approval gate) | `503`; `detail.code = RISK_RULES_PENDING_APPROVAL` |
| Empty payload `{}` | PASS | `422` required-field validation |
| Payload containing `unknownSensor` | PASS | `422`; `extra_forbidden` |
| Payload with `currentDO: 99` | PASS | `422`; exceeds schema maximum `15` mg/L |
| Initial full FastAPI `pytest` run | ENVIRONMENT ERROR | `55 passed, 3 errors`; Windows Temp access raised `PermissionError: [WinError 5]` |
| Rerun with isolated `TEMP`/`TMP` and `--basetemp` | **PASS, 58/58** | `58 passed, 2 warnings in 7.59s`; no source change for the Temp permission error |

**Final acceptance:** AQS-102 Technical Retest, HTTP Contract, Route Prefix and Approval Gate are **PASS**. Business assessment is **BLOCKED / PENDING_APPROVAL**; the regression result does not demonstrate a successful AI assessment or production-AI readiness.

## AQS-102 validator and route implementation — 2026-11-17

| Command / check | Result | Scope |
|---|---|---|
| AI `tests/test_prediction_contract_validation.py` | PASS, 20 tests | Current Core field contract, missing/type/range/non-finite/unknown rejection, canonical comprehensive route, no doubled prefix, 503 gate and 422 validation |
| AI `pytest -q` | PASS, 58 tests | Full FastAPI regression; two dependency deprecation warnings |
| AI `python -m compileall -q app` | PASS | FastAPI syntax/bytecode compilation |
| Core mapper/service/processor Vitest | PASS, 56 tests | AQS-101 request mapping, freshness, response mapping and fallback regression |
| Core build / lint | PASS / PASS | Lint retains 18 pre-existing warnings outside AQS-102 |

The two field labels called canonical and legacy in the AQS-102 request are the same wire keys in current source; mixed-conflict testing is not meaningful until an approved second vocabulary exists. The new route returns only the documented approval-gated 503; no successful assessment is claimed.

### Final local HTTP evidence

| Request | Actual result at `127.0.0.1:8002` |
|---|---|
| `GET /health` | 200; `status: ok` |
| `GET /openapi.json` | canonical comprehensive route present; doubled `/api/v1/v1/...` route absent |
| `POST comprehensive-assessment` with `{}` | 422; required-field details for all seven `ForecastRequest` fields |
| `POST comprehensive-assessment` with complete valid payload | 503; `detail.code = RISK_RULES_PENDING_APPROVAL` |

## AQS-101 PostgreSQL freshness-boundary correction — 2026-11-17 (historical, superseded by 16/16 rerun)

| Check | Result | Evidence / limitation |
|---|---|---|
| Historical dedicated PostgreSQL E2E | 14 PASS / 1 FAIL / 1 SKIP | Failed DANGER/100 fixture before persistence: `ageMs: -1` from fixture-clock ordering |
| Fixture correction | PASS by source review | E2E synthetic `recordedAt` is one second before the service clock race window; production future-time validation remains intact |
| Core mapper/service/processor regression | PASS, 56 tests | Includes exact configured 15-minute boundary acceptance and future timestamp rejection |
| Core build / lint | PASS / PASS | Lint has 18 existing warnings |
| PostgreSQL E2E rerun | BLOCKED | Docker API denied in Codex; container/port/fixture safety could not be reverified, so no write was attempted |

Do not promote this row to 15 PASS / 1 SKIP until the authorized dedicated-container rerun finishes.

## AQS-102 final E2E validation — 2026-11-17

| Command / check | Result | Scope |
|---|---|---|
| Core mapper/service/processor focused Vitest | PASS, 56 tests | Full FR-01..14 matrix where applicable: stale/future/missing/malformed timestamps, fields, non-finite values, threshold override/boundary, correlation and queue discard |
| `npm run build` | PASS | Core after final freshness test additions |
| Docker `ps -a` / loopback 55432 probe | BLOCKED | Docker API permission denied; no port listener; isolated fixture safety cannot be proven |
| PostgreSQL isolated E2E | BLOCKED, 16 tests not run | Explicit opt-in intentionally withheld because no verified isolated engine/endpoint exists |

The unchanged AI source previously passed `.venv-aqs101` full pytest 53/53. No frontend test was rerun because no frontend contract/source changed.

## AQS-102 execution follow-up — 2026-11-17

| Command / check | Result | Scope |
|---|---|---|
| Core mapper/service/processor focused Vitest | PASS, 47 tests | AQS-101 mapping/fallback regression plus stale/invalid telemetry refusal, source timestamp, request correlation and no-retry queue behavior |
| `npm run build` | PASS | Nest type/build after freshness and correlation changes |
| `npm run lint` | PASS | 18 pre-existing warnings only; no new AQS-102 warning |
| `npm run test:e2e -- test/aqs-101-prediction-persistence.e2e-spec.ts` | SKIPPED, 16 tests | Correct default behavior: explicit isolated-DB opt-in was not supplied, so no database write occurred |
| AI `.venv-aqs101` `pytest -q` | PASS, 53 tests | Existing research/contract/model regression; two dependency deprecation warnings only |

No production AI inference, shared database mutation, deployment, or frontend change was performed.

## AQS-102 audit verification — 2026-11-17

| Command / check | Result | Scope |
|---|---|---|
| `.venv-aqs101\\Scripts\\python.exe -m pytest tests/test_prediction_contract_validation.py -q` | PASS, 15 tests | FastAPI Pydantic validation, intentional 503 gate, required fields, ranges, UUID/timezone and NaN/Infinity |
| FastAPI TestClient `/openapi.json` inspection | PASS | Exact current paths: `/health`, `/api/research/forecast`, `/api/predict`; no comprehensive-assessment or duplicated `/v1` route |
| `npm exec vitest run` mapper + prediction service specs | PASS, 40 tests | AQS-101 Core payload/mapping/fallback regression |

No model inference, database integration, deployment or route implementation was run in this audit.

## AQS-101 handover verification — 2026-11-17

| Evidence | Result | Verification limit |
|---|---|---|
| Core mapper/service/processor | PASS, 42 tests | Full payload boundary, response mapping, timeout/422/503 and fallback |
| Isolated PostgreSQL prediction persistence | PASS, 16 tests | Dedicated loopback fixture, source attribution, score boundaries and cleanup |
| FastAPI full regression | PASS, 53 tests | Two dependency deprecation warnings only |
| Core build / lint | PASS / PASS | 18 existing lint warnings outside AQS-101 |
| Chromium predictions flow | PASS | Authenticated trigger/history/latest, authorization, real 503 and test-only success contract paths |
| Local 2026-11-17 DevTools run | PASS as observed | Core trigger 201; `LOW`, `0.1`/10%, `isFallback: true`; FastAPI 503. It is not proof of realtime telemetry or production AI. |

Not tested in this documentation update: approved production inference, AI-driven alert dispatch, fresh-telemetry suitability, model/risk-rule approval, deployment and a new full Core regression run.

## Source inventory

Core backend contains unit/integration/E2E-named Vitest specs for auth/OTP/session/lockout, security/rate limits, entities/database, farms/ponds/crops/devices, telemetry/gateway, alerts, predictions, notifications and functional API. AI has four pipeline task tests (`test_task_dp01`–`04`). Web package exposes build/lint but no discovered test directory. Mobile package has no discovered test script.

## Executed evidence in this workspace

### AQS-102 browser verification — 2026-11-16

| Command / check | Result | Scope |
|---|---|---|
| Playwright Chromium `real-fastapi-503` | PASS, 3 tests + 1 mock-only skip | Real UI login/route/pond selection/trigger/history/reload/mobile; current FastAPI 503 became explicit fallback |
| Playwright Chromium `ai-mock-success` | PASS, 3 tests + 1 fallback-only skip | Isolated mock-only API maps `SAFE/WARNING/DANGER` to `LOW/MEDIUM/HIGH` and renders 20/55/85% once |
| Playwright Chromium `ai-unavailable` | PASS, 3 tests + 1 mock-only skip | AI connection refusal remains a stable, explicit fallback UI |
| Browser Manager foreign-history request | PASS, 403 | Reproduced original 200 leak before source fix; verified scoped Core endpoint after fix |
| Web production build | PASS | `tsc -b && vite build`; existing chunk-size advisory only |
| Core focused prediction/notification tests and build | PASS, 40 tests / build | Prediction scope and runtime test-safety changes compile with existing coverage |

Each final browser capture had zero console errors. Sanitized network/screenshots/HTML reports live in the frontend report directory; no browser test is treated as model approval evidence.

| Command | Result | Scope |
|---|---|---|
| `npm run build` in core backend | PASS (earlier task, 2026-11-16) | Nest type/build |
| `vitest` farms + management authority | PASS, 32 tests (earlier task) | farm manager revoke and user scope |
| `functional-api.spec.ts` | 3 failures observed (earlier task) | fixtures assume old unrestricted Manager user lifecycle |
| prediction mapper/service/processor targeted Vitest | PASS, 14 tests (AQS-101, 2026-11-16) | maps risk vocabulary and 0–100 score; rejects invalid response and falls back |
| `npm test` | FAIL, 4 pre-existing-policy fixture failures (AQS-101, 2026-11-16) | 3 in `functional-api.spec.ts` and 1 `MANAGER viewing any profile -> allowed` in `security-audit.spec.ts`; prediction mapper/service/processor tests passed |
| live FastAPI contract probe | PARTIAL (AQS-101 completion audit) | `/health` and `/openapi.json` 200; `/api/predict` 404. No FastAPI inference, Nest integration or PostgreSQL persistence path is available to test |
| AQS-101B/C FastAPI + Core targeted verification | PASS / PENDING_APPROVAL | FastAPI pytest 24 passed; live research forecast 200; production route structured 503; Core mapper/service/processor 15 tests passed; persistence intentionally not run |

## AQS-101D follow-up evidence

| Command / check | Result | Scope |
|---|---|---|
| FastAPI rule/endpoint targeted pytest | PASS, 12 tests before full regression | isolated risk schema, approval gate and API/OpenAPI regression |
| FastAPI model acceptance evaluator | PASS, read-only | checksum and chronological held-out re-evaluation; not a persistence test |
| Core contract consequence | No source change required | The existing HTTP non-success fallback covers the production 503; rerun targeted Core suite after the final FastAPI check |

No PostgreSQL mutation, isolated Core+FastAPI E2E, alert emission, deployment or production success-path test is claimed here.

### Final AQS-101D recheck

The targeted Core mapper/service/processor command passed **15 tests** after the FastAPI work. The final FastAPI `pytest -q` passed **34 tests**. `npm run build` passed; `npm run lint` completed with the pre-existing warnings listed by the linter. Current-source temporary FastAPI HTTP verification returned health 200, research 200, production 503 `RISK_RULES_PENDING_APPROVAL`, and both OpenAPI routes. This remains a gate/fallback check, not a success-path persistence E2E.

## AQS-101E/F/G planned final verification

The FastAPI robustness suite adds read-only coverage, temporal-boundary and bounded cross-pond tests. Final results must be recorded after rerunning the complete AI suite and Core prediction mapper/service/processor suite. The port-8001 probes are contract checks only: no Core trigger endpoint was invoked and no `ai_prediction` persistence test ran, because the available database is shared and Docker/isolated test infrastructure is unavailable.

No browser, mobile simulator, Docker integration, DB migration, AI endpoint latency, or full regression suite was executed in this documentation task. Therefore no feature is labeled VERIFIED COMPLETE solely from test file existence.

### AQS-101E/F/G final verification result

The complete FastAPI suite passed **38 tests** (two known dependency deprecation warnings). Core prediction mapper/service/processor tests passed **15 tests**; `npm run build` passed and `npm run lint` exited 0 with 18 pre-existing unused-variable/escape/whitespace warnings outside this AQS scope. No full Core suite was rerun because it has documented unrelated fixture failures, and no Core trigger, persistence, alert, browser/mobile, Docker or isolated PostgreSQL E2E was executed.

## AQS-101K final acceptance evidence

| Check | Result | Scope |
|---|---|---|
| Core mapper/service/processor | PASS, 42 tests | complete request, all score boundaries, enum mapping, invalid response, timeout/422/503 fallback and no HTTP for incomplete telemetry |
| Core build | PASS | Nest TypeScript build |
| Core lint | PASS, 18 pre-existing warnings | no AQS-101K warning introduced |
| FastAPI contract suite | PASS, 15 tests | complete 503 gate, required fields, ranges, UUID/timezone, NaN/Infinity 422 behavior |
| FastAPI full suite | PARTIAL: 51 pass, 2 fail | both failures require unavailable local PostgreSQL telemetry |
| PostgreSQL acceptance E2E | SKIPPED, 9 cases | explicit opt-in fixture; no listener/Docker available |
| Web production build | PASS | normalized-score and fallback consumer typecheck/build |
| Core full suite | FAIL / environment | PostgreSQL and Redis are refused, causing unrelated infrastructure-dependent failures; prediction suite remains PASS |

No actual Core-trigger persistence, alert dispatch, model approval or production deployment occurred.

## AQS-101L final acceptance evidence — 2026-11-16

| Command / check | Result | Scope |
|---|---|---|
| Isolated PostgreSQL safety gate | PASS | Loopback-only `127.0.0.1:55432`, dedicated ephemeral container/network, no shared volume; verified `CREATEDB` and absent exact fixture DB before E2E |
| `npm run test:e2e -- test/aqs-101-prediction-persistence.e2e-spec.ts` | PASS, 16 tests | Real PostgreSQL persistence; five score/level boundaries, invalid/malformed response, connection-refused/timeout, fixture 422/503, and actual FastAPI 503 → `HEURISTIC_RULE` |
| Fixture cleanup query | PASS | `shrimp_aqs101_prediction_e2e` no longer existed after suite completion |
| `python -m pytest -q` in AI service | PASS, 53 tests | Includes the two formerly database-refused real-telemetry tests; two dependency deprecation warnings only |
| Core prediction mapper/service/processor | PASS, 42 tests | Request boundary, one-time score normalization, enum mapping, invalid response and controlled fallback |
| `npm run build` / `npm run lint` in Core | PASS / PASS | Lint reports the documented 18 warnings outside AQS-101 |
| Current-source FastAPI HTTP smoke | PASS | health/openapi 200, `/api/predict` complete 503 approval gate, missing salinity 422 |

No full Core suite was repeated: the required AQS-101 regression gates are the targeted suites above, and the repository has separately documented unrelated functional-policy fixture failures. No frontend code changed in AQS-101L; previously successful web build evidence remains applicable.

## AQS-202 — additional live smoke evidence (2026-11-24)

| Check | Actor | Endpoint / route | Actual | Classification |
|---|---|---|---|---|
| Anonymous telemetry latest/history | Anonymous | `GET /telemetry/device/{uuid}/latest`, `/history` | 401 / 401 | PASS, direct HTTP |
| Anonymous prediction latest/history | Anonymous | `GET /predictions/pond/{uuid}/latest`, `/history` | 401 / 401 | PASS, direct HTTP |
| Unauthenticated protected UI | Anonymous browser | `/devices` | Redirected to `/login` | PASS, direct browser |
| Frontend CORS preflight | Browser origin | `OPTIONS` to Core | 204; `Access-Control-Allow-Origin: *` | OBSERVED; allow-list not proven |
| FARMER role routes/scope/revocation | FARMER/MANAGER | Devices, Monitoring, AI Analysis, scoped Core APIs | Prior manual report only | PARTIAL / needs replayable logs |

No credential, fixture, persistence operation, MQTT publish, queue trigger,
logout or database action was performed for the direct-HTTP/browser checks.

## AQS-203 final source regression — 2026-11-24

| Check | Result | Boundary |
|---|---|---|
| Core AQS-203 selected Vitest | PASS, 357/357; 1 skipped | Alerts, Devices, Ponds, Telemetry, Predictions, AQS-202 audit and Users lockout; mocks/in-process only. |
| Core build/lint/diff | PASS | Lint exits 0 with 17 existing warnings. |
| Web lint/build | PASS | ESLint exits 0 with 139 existing warnings; Vite reports an existing 500 kB chunk advisory. |
| Web Playwright | PASS, 19/19 | Controlled API responses; not a Backend integration result. |
| Core full default suite | BLOCKED | Legacy AppModule/database and real-Redis test files require an owned isolated fixture; default execution must not target shared services. |
| Live HTTP E2E | LIVE_E2E_BLOCKED | No verified AQS-203 runtime or TEST_ONLY role/pond/device fixture was available. |
