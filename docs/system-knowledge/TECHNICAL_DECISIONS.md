# Technical Decisions

| Decision | Evidence | Rationale / trade-off |
|---|---|---|
| Five-repository workspace | root discovery | Separates core, AI, infrastructure, portal and mobile, but requires cross-repo compatibility checks |
| NestJS core with global Redis throttler | `app.module.ts` | Centralizes API business logic and 60 req/min limiter |
| Role plus ownership/assignment scoping | farms/ponds/users/devices services | UI is not trusted; backend verifies manager/farmer scope |
| Telemetry receipt ledger + post-commit MQTT ACK | telemetry service/migration | Prevents duplicate retries; requires edge `messageId` rollout |
| Farm manager can be revoked without deleting farm | migration `20261116_*`, FarmsService | Preserves farm/pond data; acting admin temporarily owns ponds |
| Central docs location | `docs/system-knowledge` | Workspace is multi-repo; one cross-system knowledge base avoids duplicate per-repo docs |
| Strict AI response boundary with heuristic fallback | AQS-101 prediction mapper | External responses are untrusted: validate fields and map vocabulary before persistence; keep prediction service available on transport/contract failure |
| Keep Core fallback until ML target approval | AQS-101A dataset audit | Real telemetry exists, but forecast target/horizon and acceptance metrics are not approved; do not expose a technical experiment as `AI_MODEL` |
| Retain strict HTTP non-success fallback | AQS-101E/F/G robustness and policy audit | 503 from an unapproved/unknown FastAPI service must remain `HEURISTIC_RULE`; Core cannot infer approval from model-like fields or local thresholds |
| Do not redirect Core to port 8001 | runtime listener ownership is unknown | Matching routes prove a contract, not an owned release, artifact identity or deployment authorization |
| Preserve current Core contract | FastAPI future-success schema remains mapper-compatible | No DTO/entity/migration/frontend change is justified while operational AI predictions are gated |
| Validate complete FastAPI input before transport | AQS-101K schema recheck found salinity/turbidity required | Missing/invalid sensor data must choose deterministic fallback, never fabricate values or trigger avoidable 422 responses |
| Use opt-in disposable PostgreSQL acceptance fixture | AQS-101K requires persistence proof without touching business data | exact local database name, pre-existence refusal and own-database cleanup prevent accidental overwrite; suite stays skipped by default |
| Preserve model/rule gate during mapping acceptance | AQS-101K scope separates integration from scientific/operational approval | test-only HTTP approved responses exercise mapping; real FastAPI remains 503 and model/rules remain unapproved |
