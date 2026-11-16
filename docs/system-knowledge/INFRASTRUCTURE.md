# Infrastructure

`shrimp-infrastructure/docker-compose.yml` declares TimescaleDB (5432), RabbitMQ + management UI (5672/15672), Mosquitto (1883), and Redis host port 6380. Named volume: `local_db_data`; Docker network: `shrimp_local_net`. PostgreSQL init scripts define schema/seed data.

Operational notes:

- Docker CLI exists but Docker API/socket access was denied during 2026-11-16 audit; containers, volumes and networks are **UNKNOWN**, not stopped or altered.
- Core `.env.example` and AI/infrastructure examples define configuration contracts. Local `.env` files were not recorded or copied because they may contain secrets.
- CI found: backend `.github/workflows/ci.yml`, triggered only for main/master push/PR, installs dependencies and runs build. No full test step is defined in the discovered workflow.
- Disk: C: free space ~4.26 GB; D: ~25.88 GB. Avoid image builds/cache-heavy test runs on C: without cleanup authorization.
