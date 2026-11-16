# Module Catalog

## Core backend

| Module | Trách nhiệm | Điểm vào chính | Dữ liệu chính |
|---|---|---|---|
| Auth | OTP, đăng ký, login, refresh, sessions/password | `auth.controller.ts` | users, user_sessions, Redis OTP/lockout |
| Users | profile, FCM token, quản trị user | `users.controller.ts` | users, pond assignments |
| Farms | quản lý farm và phân công manager | `farms.controller.ts` | farms, pond |
| Ponds | ao, threshold, manual log, phân công farmer | `ponds.controller.ts` | pond, threshold_config, manual_test_log |
| Crops | vụ nuôi, mật độ, thu hoạch | `crops.controller.ts` | shrimp_batches, harvest_logs |
| Devices | IoT lifecycle/gán ao/báo hỏng | `devices.controller.ts` | device, alert |
| Telemetry | MQTT ingest, history/latest, Socket.IO, health cron | `telemetry.*` | telemetry_data, ingest receipts |
| Alerts | danh sách và resolve cảnh báo | `alerts.controller.ts` | alert, ai_recommendation |
| Predictions | trigger/lấy dự báo | `predictions.controller.ts` | ai_prediction, queue/AI HTTP |
| Notifications | preferences, FCM token, inbox, dispatch | `notifications.*` | notification_* |

## Client/UI

Portal pages: Dashboard, Farms, Monitoring, Alerts, Devices, AI Analysis, Staff, Profile/Settings, Login/Forgot password. Mobile tabs: Overview, Ponds, Analytics, Alerts, Settings; stack: Auth, ForceChangePassword, Main.

## AI/data

`app/services/pipeline.py` chứa truy vấn telemetry, cleaning/interpolation, feature extraction và time-aware split. `app/data/generate_synthetic_data.py` tạo data thử nghiệm. Source hiện không có router/model modules được nêu trong kế hoạch AI `AGENTS.md`.
