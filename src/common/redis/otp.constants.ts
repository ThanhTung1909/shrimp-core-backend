import { normalizePhone } from './rate-limit.constants.js';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getEmailOtpIdentifier(email: string): string {
  return `email:${normalizeEmail(email)}`;
}

export function normalizeOtpIdentifier(identifier: string): string {
  if (typeof identifier === 'string' && identifier.startsWith('email:')) {
    const email = normalizeEmail(identifier.slice(6));
    return email ? `email:${email}` : '';
  }
  return normalizePhone(identifier);
}

export enum OtpPurpose {
  REGISTER = 'REGISTER',
  RESET_PASSWORD = 'RESET_PASSWORD',
  CHANGE_PASSWORD = 'CHANGE_PASSWORD',
  LOGIN = 'LOGIN',
}

/**
 * Cấu hình các hằng số bảo mật cho hệ thống OTP (One-Time Password) qua Redis.
 */
export const OTP_CONFIG = {
  TTL_SECONDS: 300, // Thời gian sống của OTP: 5 phút (300 giây)
  MAX_ATTEMPTS: 5, // Số lần nhập sai tối đa trước khi hủy mã: 5 lần
  VERIFIED_TTL_SECONDS: 600, // Thời gian sống của marker đã xác thực: 10 phút (600 giây)
} as const;

/**
 * Khóa Redis lưu trữ SHA-256 hash của mã OTP.
 */
export function getOtpCodeKey(purpose: OtpPurpose, phone: string): string {
  return `otp:${purpose}:code:${normalizeOtpIdentifier(phone)}`;
}

/**
 * Khóa Redis lưu trữ số lần nhập sai của OTP hiện tại.
 */
export function getOtpAttemptsKey(purpose: OtpPurpose, phone: string): string {
  return `otp:${purpose}:attempts:${normalizeOtpIdentifier(phone)}`;
}

/**
 * Khóa Redis lưu trữ trạng thái đã xác thực thành công số điện thoại.
 */
export function getOtpVerifiedKey(purpose: OtpPurpose, phone: string): string {
  return `otp:${purpose}:verified:${normalizeOtpIdentifier(phone)}`;
}

// Aliases
export const otpCodeKey = getOtpCodeKey;
export const otpAttemptsKey = getOtpAttemptsKey;
export const otpVerifiedKey = getOtpVerifiedKey;
