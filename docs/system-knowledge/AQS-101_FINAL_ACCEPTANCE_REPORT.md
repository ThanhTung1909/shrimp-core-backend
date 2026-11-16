# AQS-101 Final Acceptance Report

## AQS-101L final acceptance update — 2026-11-16

**AQS-101 ORIGINAL TASK = COMPLETED.** This update supersedes the historical AQS-101K E2E-blocked snapshot retained below. It does **not** approve the model, risk rules or production AI rollout.

| Acceptance evidence | Actual result |
|---|---|
| Isolated PostgreSQL | PASS — dedicated, loopback-only ephemeral container at `127.0.0.1:55432`; no shared volume or existing database was used |
| Fixture safety | PASS — local host only, explicit endpoint differs from Core `.env`, `CREATEDB` checked, fixture absence checked; the suite created and dropped only `shrimp_aqs101_prediction_e2e` |
| Persistence E2E | PASS — 16/16 cases against PostgreSQL with real TypeORM schema synchronization and persisted-row queries |
| AI fixture mapping | PASS — `SAFE/WARNING/DANGER` persisted as `LOW/MEDIUM/HIGH`; scores `0/25/50/75/100` persisted as `0/.25/.5/.75/1`; valid rows are `AI_MICROSERVICE` |
| Fallback persistence | PASS — invalid enum/score/type/missing-field, malformed JSON, connection refusal, real timeout, fixture HTTP 422/503 and the actual local FastAPI approval-gate 503 all persisted `HEURISTIC_RULE`, never a raw AI enum or false AI source |
| Alert isolation | PASS — no alert rows were emitted by prediction calls in the fixture database |
| FastAPI regression | PASS — previously blocked two tests passed; full `pytest -q` is 53 passed (two dependency deprecation warnings) |
| Core regression | PASS — mapper/service/processor 42 passed; build passed; lint exited 0 with 18 pre-existing warnings outside AQS-101 |
| Frontend compatibility | VERIFIED — no frontend/API-consumer change was needed; prior production build evidence remains valid because Core response fields and score semantics did not change in AQS-101L |

### Runtime and approval boundary

An owned, temporary FastAPI process from the current source was launched only on loopback port 8001 for this acceptance run. `GET /health` and `/openapi.json` returned 200; the OpenAPI document contains `/api/predict`; complete input returned 503 and missing `salinity` returned 422. The 503 is expected and its persisted Core result is the verified heuristic fallback, not an AI-model result.

`MODEL_ACCEPTANCE = PENDING_APPROVAL`; `RISK_RULE_APPROVAL = PENDING_APPROVAL`; `PRODUCTION_AI = BLOCKED`. No artifact, model/rule approval, production database, alert adapter, commit, push or deployment was changed.

### Reproducible isolated E2E command

```powershell
$env:AQS101_POSTGRES_INTEGRATION='true'
$env:AQS101_TEST_DATABASE='shrimp_aqs101_prediction_e2e'
$env:AQS101_TEST_DB_HOST='127.0.0.1'
$env:AQS101_TEST_DB_PORT='55432'
$env:AQS101_TEST_DB_USER='aqs101_e2e'
$env:AQS101_REAL_FASTAPI_URL='http://127.0.0.1:8001/api/predict'
npm run test:e2e -- test/aqs-101-prediction-persistence.e2e-spec.ts
```

The password variable is intentionally omitted: this disposable local role used container-local trust authentication. Do not substitute a shared or production endpoint.

### Post-test resource state

The fixture database was dropped and its absence was verified. The test FastAPI process was stopped. The dedicated E2E container/network remains running only because its `--rm` behavior would auto-delete its anonymous PostgreSQL volume; this was intentionally not done under the no-volume-deletion constraint. It is isolated from existing containers and binds only `127.0.0.1:55432`.

## Verdict

**AQS-101 ORIGINAL TASK = PARTIAL / E2E_BLOCKED.**

The Core payload boundary, response mapper, controlled fallback and frontend compatibility have evidence. The final requirement—actual PostgreSQL persistence against a newly verified isolated database—could not run because the local PostgreSQL listener is unavailable and Docker daemon access is denied. This report does not equate mapper/unit success with persistence acceptance.

## Requirements traceability

| Requirement | Evidence | Result |
|---|---|---|
| Full request fields | Core request builder accepts only UUID, timezone-aware timestamp, DO, pH, temperature, salinity and turbidity matching FastAPI ranges | PASS at source/unit boundary |
| No Core-caused missing-field 422 | Missing/non-finite/out-of-range sensor input prevents outbound HTTP and persists controlled `HEURISTIC_RULE` fallback | PASS, 42 targeted Core tests |
| `SAFE/WARNING/DANGER` mapping | mapper produces `LOW/MEDIUM/HIGH` only | PASS, fixture cases 0/25/50/75/100 |
| Score normalisation | finite inclusive 0..100 maps once to 0..1; invalid score is rejected | PASS, mapper/service tests |
| Invalid AI response protection | malformed enum, string/NaN/infinite/out-of-range score and malformed/missing fields use fallback, never `AI_MICROSERVICE` | PASS, targeted Core tests |
| FastAPI request validation | complete payload reaches intentional 503 gate; missing/invalid/non-finite fields return 422 | PASS, 15 isolated FastAPI contract tests; live port-8001 checks for complete/missing-salinity payload |
| Real research inference | requires live PostgreSQL telemetry/history | NOT RUN in this task; database is unavailable |
| Test-only approved response persistence | opt-in local PostgreSQL E2E suite implemented with HTTP fixture, exact fixture DB guard and cleanup | IMPLEMENTED, NOT RUN |
| Real FastAPI 503 fallback persistence | requires same isolated PostgreSQL environment | E2E_BLOCKED |
| Alerts safety | `PredictionsService` has no alert dispatch dependency; E2E checks alert count in its isolated DB | IMPLEMENTED, NOT RUN |
| Frontend compatibility | web consumes Core `LOW/MEDIUM/HIGH`, multiplies normalized `riskScore` once for percentage display and labels fallback | VERIFIED by source review and production build |

## Actual HTTP evidence

The existing, ownership-unconfirmed development listener at `127.0.0.1:8001` was queried read-only on 2026-11-16.

| Request | Result |
|---|---|
| `GET /health` | 200 |
| `GET /openapi.json` | 200; `/health`, `/api/research/forecast`, `/api/predict` present |
| complete `POST /api/predict` | 503 `RISK_RULES_PENDING_APPROVAL` |
| `POST /api/predict` without salinity | 422, required field validation |

The 503 is expected and is not a payload failure. The listener is not treated as an owned deployment, and no approval state was changed.

## Persistence E2E safety design

`test/aqs-101-prediction-persistence.e2e-spec.ts` is disabled by default. It runs only with both explicit opt-ins:

```powershell
$env:AQS101_POSTGRES_INTEGRATION='true'
$env:AQS101_TEST_DATABASE='shrimp_aqs101_prediction_e2e'
npm run test:e2e -- test/aqs-101-prediction-persistence.e2e-spec.ts
```

Before any write, it requires a local host, connects to the administrative `postgres` database, refuses if the exact fixture database already exists, verifies `CREATEDB`, creates its own database, synchronizes a disposable schema and creates only test fixtures. It uses a local HTTP fixture for permitted `SAFE/WARNING/DANGER` scores, queries the persisted `AiPrediction` rows, confirms source attribution/no alerts and drops only the fixture database it created.

## Files changed by AQS-101K

- `src/modules/predictions/contracts/ai-prediction.mapper.ts`
- `src/modules/predictions/predictions.service.ts`
- `src/modules/predictions/contracts/ai-prediction.mapper.spec.ts`
- `src/modules/predictions/predictions.service.spec.ts`
- `test/aqs-101-prediction-persistence.e2e-spec.ts`
- `shrimp-ai-service/app/main.py`
- `shrimp-ai-service/tests/test_prediction_contract_validation.py`
- related API/test/current-state documentation in both repositories.

## Tests and blockers

| Command/check | Result |
|---|---|
| Core prediction mapper/service/processor | PASS, 42 tests |
| Core `npm run build` | PASS |
| Core `npm run lint` | PASS with 18 pre-existing warnings |
| Core full `npm test` | FAIL: PostgreSQL/Redis unavailable; failures are outside prediction suite |
| FastAPI contract test | PASS, 15 tests |
| FastAPI full pytest | 51 PASS, 2 FAIL: live telemetry/database tests cannot connect to `localhost:5432` |
| PostgreSQL persistence E2E | SKIPPED / E2E_BLOCKED: no PostgreSQL listener, Docker inaccessible |
| Web `npm run build` | PASS; only existing chunk-size warning |

## Remaining acceptance conditions

1. Restore access to an owned local Docker/PostgreSQL environment; do not alter existing volumes or database.
2. Run the opt-in persistence suite above and retain its results.
3. With a known owned FastAPI development release and test data, run research inference plus Core-to-FastAPI 503 persistence flow against the isolated database.
4. Only then set `AQS-101 ORIGINAL TASK = COMPLETED`. This does not change `MODEL_APPROVAL = PENDING_APPROVAL` or `PRODUCTION_AI = BLOCKED`.
