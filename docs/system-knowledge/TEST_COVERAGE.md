# Test Coverage and Verification

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
