# AquaSense System Knowledge Base

Knowledge base này mô tả workspace `D:\Khóa Luận\Project` gồm 5 repository độc lập. Nguồn sự thật là source code và Git; tài liệu chỉ ghi nhận bằng chứng tại thời điểm khảo sát **2026-11-16**.

## Snapshot discovery

Phát hiện 11 module backend, 18 TypeORM entities, 76 HTTP method decorators trong controller, 10 web route cấp cao, 8 mobile screen và 57 file spec/test TypeScript backend. Các số liệu là inventory tĩnh, không phải số lượng chức năng đã runtime-verified.

| Tài liệu | Nội dung |
|---|---|
| [SYSTEM_OVERVIEW](SYSTEM_OVERVIEW.md) | Bối cảnh và thành phần hệ thống |
| [ARCHITECTURE](ARCHITECTURE.md) | Kiến trúc, runtime và luồng tích hợp |
| [MODULE_CATALOG](MODULE_CATALOG.md) | Danh mục module và ứng dụng |
| [FUNCTIONALITY_INVENTORY](FUNCTIONALITY_INVENTORY.md) | Chức năng, trạng thái và bằng chứng |
| [API_CATALOG](API_CATALOG.md) / [DATABASE_CATALOG](DATABASE_CATALOG.md) | API và dữ liệu |
| [PERMISSION_MATRIX](PERMISSION_MATRIX.md) / [BUSINESS_FLOWS](BUSINESS_FLOWS.md) | Quyền và luồng nghiệp vụ |
| [COMPONENT_CATALOG](COMPONENT_CATALOG.md) / [INTEGRATION_CATALOG](INTEGRATION_CATALOG.md) | UI clients và tích hợp |
| [INFRASTRUCTURE](INFRASTRUCTURE.md) / [DEPENDENCY_MAP](DEPENDENCY_MAP.md) | Vận hành và phụ thuộc |
| [TEST_COVERAGE](TEST_COVERAGE.md) / [KNOWN_ISSUES](KNOWN_ISSUES.md) | Bằng chứng test và hạn chế |
| [TECHNICAL_DECISIONS](TECHNICAL_DECISIONS.md) / [TASK_HISTORY](TASK_HISTORY.md) / [CURRENT_STATE](CURRENT_STATE.md) | Quyết định, lịch sử và handover |

Quy ước trạng thái: **VERIFIED COMPLETE** chỉ dùng khi có bằng chứng test/runtime; **IMPLEMENTED / UNVERIFIED** khi source tồn tại nhưng chưa xác minh ở lần khảo sát; **PARTIAL**, **BROKEN**, **NOT IMPLEMENTED**, **UNKNOWN** được dùng theo bằng chứng.
