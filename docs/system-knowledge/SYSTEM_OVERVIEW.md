# System Overview

## Mục tiêu

AquaSense là hệ thống quản lý nuôi tôm IoT: quản lý farm/ao/nhân sự/thiết bị, thu thập telemetry, cảnh báo, dự báo AI, thông báo và hai client portal/mobile.

## Thành phần phát hiện

| Repository | Vai trò | Công nghệ | Trạng thái khảo sát |
|---|---|---|---|
| `shrimp-core-backend` | API, auth, nghiệp vụ, realtime | NestJS, TypeORM, PostgreSQL/TimescaleDB, Redis, MQTT, RabbitMQ/BullMQ | IMPLEMENTED / UNVERIFIED |
| `shrimp-ai-service` | Pipeline dữ liệu và health endpoint | Python/FastAPI, pandas/sklearn/joblib | PARTIAL |
| `shrimp-infrastructure` | Local Compose và DB seed | Docker Compose, TimescaleDB, RabbitMQ, Mosquitto, Redis | IMPLEMENTED / UNVERIFIED |
| `Smart Shrimp Farm/web` | Portal quản trị | React 19, Vite, TypeScript, Tailwind, Socket.IO | IMPLEMENTED / UNVERIFIED |
| `shrimp-mobile-app` | Mobile client | Expo 57, React Native, Redux Toolkit, Axios | IMPLEMENTED / UNVERIFIED |

Roles mã nguồn: `ADMIN`, `MANAGER`, `FARMER`. Core backend mặc định dùng cổng `3000`; AI service cấu hình cổng `8000`; hạ tầng local công bố PostgreSQL `5432`, MQTT `1883`, RabbitMQ `5672/15672`, Redis `6380`.
