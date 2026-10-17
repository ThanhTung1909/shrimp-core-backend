export const LOGIN_LOCKOUT_CONFIG = {
  FAILURE_WINDOW_SECONDS: 15 * 60,
  TEMP_LOCK_THRESHOLD: 3,
  TEMP_LOCK_SECONDS: 30,
  MANUAL_LOCK_THRESHOLD: 5,
} as const;

export const LOCKOUT_ERROR_CODES = {
  TEMPORARILY_LOCKED: 'ACCOUNT_TEMPORARILY_LOCKED',
  PENDING_ADMIN_UNLOCK: 'ACCOUNT_PENDING_ADMIN_UNLOCK',
} as const;

export const LOCKOUT_MESSAGES = {
  TEMPORARILY_LOCKED:
    'Tài khoản tạm thời bị khóa do đăng nhập sai nhiều lần. Vui lòng thử lại sau 30 giây.',
  PENDING_ADMIN_UNLOCK:
    'Tài khoản đã bị khóa do đăng nhập sai quá số lần cho phép. Vui lòng liên hệ quản trị viên để được mở khóa.',
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
