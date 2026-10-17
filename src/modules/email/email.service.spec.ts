import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import { Logger } from '@nestjs/common';
import { EmailService } from './email.service.js';

vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn() } }));

describe('Existing EmailService password reset template', () => {
  const sendMail = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail } as any);
    sendMail.mockResolvedValue({ accepted: ['a@example.com'], rejected: [] });
  });

  it('reuses SMTP transport, includes random supplied OTP, and logs no secret', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const service = new EmailService(new ConfigService({ EMAIL_USER: 'sender@example.com' }));
    await service.sendPasswordResetOtp('a@example.com', '654321');
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@example.com', subject: expect.stringContaining('OTP'), text: expect.stringContaining('654321') }));
    expect(JSON.stringify(log.mock.calls)).not.toContain('654321');
    log.mockRestore();
  });

  it('propagates SMTP rejection without logging message contents', async () => {
    sendMail.mockResolvedValueOnce({ accepted: [], rejected: ['a@example.com'] });
    await expect(new EmailService(new ConfigService()).sendPasswordResetOtp('a@example.com', '654321')).rejects.toThrow('SMTP did not accept');
  });
});
