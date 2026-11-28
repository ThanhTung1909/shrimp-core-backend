export type SensitiveUserField =
  | 'passwordHash'
  | 'fcmToken'
  | 'tokenVersion'
  | 'isLocked'
  | 'mustChangePassword';

export type SanitizedUser<T> = Omit<T, SensitiveUserField>;

export function sanitizeUser<T extends object>(user: T): SanitizedUser<T>;
export function sanitizeUser<T extends object>(
  user: T | null | undefined,
): SanitizedUser<T> | undefined;
export function sanitizeUser<T extends object>(
  user: T | null | undefined,
): SanitizedUser<T> | undefined {
  if (!user || typeof user !== 'object') {
    return undefined;
  }

  const {
    passwordHash: _passwordHash,
    fcmToken: _fcmToken,
    tokenVersion: _tokenVersion,
    isLocked: _isLocked,
    mustChangePassword: _mustChangePassword,
    ...safeUser
  } = user as T & Partial<Record<SensitiveUserField, unknown>>;

  return safeUser as SanitizedUser<T>;
}
