# Current State and Handover

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
