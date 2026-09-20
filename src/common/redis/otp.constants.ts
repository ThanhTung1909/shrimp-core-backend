import { normalizePhone } from './rate-limit.constants.js';

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
export function getOtpCodeKey(phone: string): string {
  return `otp:code:${normalizePhone(phone)}`;
}

/**
 * Khóa Redis lưu trữ số lần nhập sai của OTP hiện tại.
 */
export function getOtpAttemptsKey(phone: string): string {
  return `otp:attempts:${normalizePhone(phone)}`;
}

/**
 * Khóa Redis lưu trữ trạng thái đã xác thực thành công số điện thoại.
 */
export function getOtpVerifiedKey(phone: string): string {
  return `otp:verified:${normalizePhone(phone)}`;
}

// Aliases
export const otpCodeKey = getOtpCodeKey;
export const otpAttemptsKey = getOtpAttemptsKey;
export const otpVerifiedKey = getOtpVerifiedKey;
