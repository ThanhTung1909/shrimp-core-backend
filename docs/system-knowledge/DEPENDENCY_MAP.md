# Dependency Map

| Consumer | Dependency | Interface / evidence |
|---|---|---|
| Web | Core API | fetch wrapper (`web/src/services/api.ts`), refresh endpoint |
| Web | Core telemetry | Socket.IO client to `/telemetry` |
| Mobile | Core API | Axios interceptor (`mobile/src/services/apiClient.ts`) |
| Mobile | Core telemetry | `socketService`, pond subscriptions |
| Core | PostgreSQL/TimescaleDB | TypeORM `forRootAsync`, telemetry repository |
| Core | Redis | cache/pubsub/rate-limit/OTP/lockout/cooldown |
| Core | MQTT | bootstrap connectivity + telemetry MQTT service |
| Core | RabbitMQ/BullMQ | infrastructure config and notification/prediction queue modules |
| Core | AI service | configured prediction API URL and prediction processor |
| AI | PostgreSQL/Redis/RabbitMQ | configuration/pipeline intent; runtime client use not fully found |

External dependencies and versions are declared in the respective `package.json`/`requirements.txt`. Java/Docker executables exist in the host audit, but Docker daemon was not accessible.
