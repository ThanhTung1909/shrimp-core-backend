# Known Issues and Gaps

## AQS-102 note — 2026-11-16

No new unresolved browser-integration defect remains in the tested predictions flow. The production AI gate remains intentionally unresolved: a real FastAPI `503 RISK_RULES_PENDING_APPROVAL` must continue to display Core’s labelled fallback until model acceptance and risk-rule approval are complete. The successful AI response used in AQS-102 is a localhost-only contract double and must never be interpreted as research/model/production validation.

| Severity | Evidence | Impact / recommendation |
|---|---|---|
| High | Experimental DO/pH forecast is available, but risk thresholds, score formula, acceptance metrics and rollout approval are PENDING_APPROVAL | Keep `/api/predict` gated at 503 and Core on heuristic fallback; do not persist AI model predictions or emit operational risk alerts |
| Medium | Portal staff creation uses `/auth/register`; new manager workflow expects `/users` plus `pondId` | Manager UI will receive backend authorization failure until synchronized |
| Medium | `functional-api.spec.ts` had 3 observed failures after new farm-scoped Manager rules | Update fixtures/expectations, then rerun full functional suite |
| Medium | Two device fault endpoints (`report-fault`, `report-broken`) invoke equivalent behavior | Select canonical endpoint; retain alias only for compatibility |
| Medium | `DEVICE_STALE_TIMEOUT_MINUTES` fallback is 2 in source while template value is 15 | Decide intended default and document it |
| Medium | Docker API denied; no container/DB/queue health validation | Restore Docker access and run safe health checks before integration claims |
| Low | Infrastructure README contains real-looking setup credentials | Sanitize documentation before sharing outside controlled development context |
| Low | Core CI discovered only builds on main/master | Add lint/tests/feature branch or PR coverage when authorized |

## AQS-101D additions

| Severity | Evidence | Impact / recommendation |
|---|---|---|
| High | Active Core pond thresholds conflict by metric alias and are not versioned/approved forecast rules | Do not inject `threshold_config` into FastAPI prediction scoring. Establish a governed ruleset and mapping/ownership plan. |

## AQS-101E/F/G additions

| Severity | Evidence | Required action |
|---|---|---|
| High | Frozen AI holdout has zero target DO values below 5 mg/L and no eligible multi-period rolling-origin fold | Retain the production gate; collect and preserve independent low-DO and time-separated validation data before model approval. |
| High | No farm-approved versioned DO/pH risk profile or score band exists | Keep Core heuristic fallback; complete species/system-aware approval, versioning and rollback before enabling AI persistence. |
| Medium | Port 8001 is contract-compatible but ownership/working directory are unknown; port 8000 is old | Create an owned launcher/release identity check; do not redirect Core based on an unknown process. |
| Medium | No isolated Core/FastAPI/PostgreSQL environment is available | Run success-path persistence and alert-side-effect tests only against an isolated database after approval. |
| High | Experimental held-out data has no target DO below 5 mg/L | Do not represent the model as validated for low-oxygen danger detection; require representative acceptance data. |
| High | AI production success/persistence/alert path remains untested by design | Keep Core fallback active; run only in an isolated test DB after both approvals. |

This catalog does not assert production incidents; each item is limited to source/audit evidence.

## AQS-101K acceptance blocker

| Severity | Evidence | Required action |
|---|---|---|
| High | `localhost:5432` is refused and Docker daemon access is denied; no isolated PostgreSQL fixture can be created | Restore owned development infrastructure, then run `aqs-101-prediction-persistence.e2e-spec.ts` with its explicit fixture guard. |
| Medium | The existing port-8001 listener passes only contract checks; ownership/CWD remain unknown | Establish an owned development launcher before claiming end-to-end Core integration. |
| Medium | FastAPI full regression has two database-dependent failures while the new isolated contract suite passes | Re-run after PostgreSQL recovery; do not weaken the real-inference tests. |

## AQS-101L resolution note — 2026-11-16

The AQS-101K local-infrastructure blockers above are historical and resolved for controlled acceptance testing: Docker Engine was reachable through an alternate read-only client configuration, a disposable loopback PostgreSQL fixture was used, the Core persistence E2E passed 16/16, and FastAPI `pytest -q` passed 53/53. The default Docker client-profile ACL/WSL inspection issue was not changed; no Docker ACL, VHDX, shared volume or existing database was modified.

The production-risk issues in the earlier sections remain open: model and risk-rule approval are still pending, so operational `/api/predict` must remain fail-closed and Core must retain heuristic fallback.
