/**
 * Định nghĩa cấu hình các ngưỡng giới hạn (Rate Limits) cho hệ thống Authentication.
 * Không hard-code các con số rải rác trong Controller hoặc Service.
 */

export const RATE_LIMIT_CONFIG = {
  LOGIN: {
    IP_LIMIT: 10,
    IP_WINDOW: 60,
    PHONE_LIMIT: 5,
    PHONE_WINDOW: 300,
  },
  REFRESH: {
    IP_LIMIT: 30,
    IP_WINDOW: 60,
  },
  REGISTER: {
    IP_LIMIT: 5,
    IP_WINDOW: 600,
  },
  OTP_SEND: {
    PHONE_LIMIT: 1,
    PHONE_WINDOW: 60,
    IP_LIMIT: 5,
    IP_WINDOW: 600,
  },
  OTP_VERIFY: {
    PHONE_LIMIT: 5,
    PHONE_WINDOW: 300,
  },
} as const;

/**
 * Chuẩn hóa địa chỉ IP:
 * - Trả về '127.0.0.1' nếu ip null/undefined/rỗng.
 * - Loại bỏ prefix IPv6-mapped IPv4 '::ffff:'.
 * - Chuẩn hóa '::1' thành '127.0.0.1'.
 */
export function normalizeIp(ip?: string | null): string {
  if (!ip || typeof ip !== 'string') {
    return '127.0.0.1';
  }
  let cleaned = ip.trim();
  if (cleaned.startsWith('::ffff:')) {
    cleaned = cleaned.substring(7);
  }
  if (cleaned === '::1') {
    cleaned = '127.0.0.1';
  }
  return cleaned;
}

/**
 * Chuẩn hóa số điện thoại:
 * - Trả về chuỗi rỗng nếu phone null/undefined/rỗng.
 * - Cắt khoảng trắng đầu cuối và loại bỏ toàn bộ khoảng trắng thừa bên trong.
 */
export function normalizePhone(phone?: string | null): string {
  if (!phone || typeof phone !== 'string') {
    return '';
  }
  return phone.trim().replace(/\s+/g, '');
}

/**
 * Helper sinh key Redis theo chuẩn định dạng:
 */
export function getLoginIpKey(ip?: string | null): string {
  return `rl:login:ip:${normalizeIp(ip)}`;
}

export function getLoginPhoneKey(phone?: string | null): string {
  return `rl:login:phone:${normalizePhone(phone)}`;
}

export function getRefreshIpKey(ip?: string | null): string {
  return `rl:refresh:ip:${normalizeIp(ip)}`;
}

export function getRegisterIpKey(ip?: string | null): string {
  return `rl:register:ip:${normalizeIp(ip)}`;
}

export function getOtpSendPhoneKey(phone?: string | null): string {
  return `rl:otp:send:phone:${normalizePhone(phone)}`;
}

export function getOtpSendIpKey(ip?: string | null): string {
  return `rl:otp:send:ip:${normalizeIp(ip)}`;
}

export function getOtpVerifyPhoneKey(phone?: string | null): string {
  return `rl:otp:verify:phone:${normalizePhone(phone)}`;
}
