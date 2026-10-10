export const LOGIN_LOCKOUT_CONFIG = {
  FAILURE_WINDOW_SECONDS: 15 * 60,
  TEMP_LOCK_THRESHOLD: 3,
  TEMP_LOCK_SECONDS: 30,
  MANUAL_LOCK_THRESHOLD: 5,
} as const;

export function getLoginFailKey(userId: string): string {
  return `auth:login-fail:${userId.toLowerCase()}`;
}

export function getLoginTempLockKey(userId: string): string {
  return `auth:login-temp-lock:${userId.toLowerCase()}`;
}

/** A durable latch prevents a PostgreSQL write failure from reopening login. */
export function getLoginPendingManualKey(userId: string): string {
  return `auth:login-pending-manual:${userId.toLowerCase()}`;
}
