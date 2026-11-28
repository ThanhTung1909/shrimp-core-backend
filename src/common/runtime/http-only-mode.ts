/**
 * Runtime safety switch for read-only, live HTTP verification.
 *
 * This value is intentionally read directly from the process environment:
 * ConfigModule loads `.env` after module metadata is evaluated, while imports
 * for queues, schedulers and gateway providers must be decided before then.
 * Set AQS_HTTP_ONLY=true in the process that starts Nest; do not add it to a
 * shared .env file.
 */
export const HTTP_ONLY_MODE_ENV = 'AQS_HTTP_ONLY';

export function isHttpOnlyMode(value = process.env[HTTP_ONLY_MODE_ENV]): boolean {
  return value?.trim().toLowerCase() === 'true';
}

export function isReadOnlyHttpMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

interface RuntimeConfigReader {
  get<T = unknown>(key: string): T | undefined;
}

/**
 * TypeORM has safe defaults for migrations and schema drops, but we pin them
 * here so the HTTP-only contract remains explicit and regression-testable.
 */
export function createDatabaseStartupOptions(
  config: RuntimeConfigReader,
  httpOnlyMode = isHttpOnlyMode(),
) {
  return {
    type: 'postgres' as const,
    host: config.get<string>('DB_HOST'),
    port: config.get<number>('DB_PORT'),
    username: config.get<string>('DB_USER'),
    password: config.get<string>('DB_PASS'),
    database: config.get<string>('DB_NAME'),
    autoLoadEntities: true,
    synchronize: !httpOnlyMode && config.get<string>('DB_SYNCHRONIZE') === 'true',
    migrationsRun: false,
    dropSchema: false,
  };
}
