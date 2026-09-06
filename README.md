# Shrimp Core Backend

Core backend service for the IoT-based shrimp farming management system, built with NestJS, PostgreSQL/TimescaleDB, MQTT, and RabbitMQ.

## Tech Stack

- **Framework:** NestJS (v10/v12)
- **Database:** PostgreSQL with TimescaleDB extension
- **Brokers:** Mosquitto (MQTT for IoT devices) & RabbitMQ (AMQP for internal events)
- **Runtime:** Node.js v20.x

## Prerequisites

- Node.js (v20.x recommended via NVM)
- Docker & Docker Compose (for running TimescaleDB, Mosquitto, and RabbitMQ)

## Environment Setup

Create a `.env` file in the root directory

## Installation & Running

1. Install dependencies:

```Bash
npm install
```

2. Run infrastructure services via Docker:
   Ensure your local Docker containers for PostgreSQL/TimescaleDB, Mosquitto, and RabbitMQ are up and running.
3. Start the application in development mode:

```Bash
npm run start:dev
```
## Project Directory Structure
shrimp-core-backend/
├── .github/
│   └── workflows/
│       └── ci.yml
├── src/
│   ├── common/
│   │   ├── decorators/
│   │   ├── filters/
│   │   ├── guards/
│   │   └── interceptors/
│   ├── modules/
│   │   ├── alerts/
│   │   ├── amqp/
│   │   ├── auth/
│   │   ├── devices/
│   │   ├── mqtt/
│   │   ├── notifications/
│   │   ├── orchestrator/
│   │   ├── ponds/
│   │   ├── predictions/
│   │   ├── telemetry/
│   │   └── users/
│   ├── app.module.ts
│   └── main.ts
├── .env
├── package.json
└── README.md