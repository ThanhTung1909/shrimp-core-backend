import { describe, expect, it, vi } from 'vitest';
import { EmailService } from './email.service.js';

describe('EmailService alert transport', () => {
  const config = {
    get: vi.fn((key: string) => {
      const values: Record<string, string> = {
        EMAIL_HOST: 'smtp.example.test',
        EMAIL_PORT: '587',
        EMAIL_USER: 'sender@example.test',
        EMAIL_PASS: 'test-password',
        EMAIL_TIMEOUT_MS: '1234',
      };
      return values[key];
    }),
  };

  it('configures explicit SMTP timeouts', () => {
    const service = new EmailService(config as any);
    const options = (service as any).transporter.options;

    expect(options.connectionTimeout).toBe(1234);
    expect(options.greetingTimeout).toBe(1234);
    expect(options.socketTimeout).toBe(1234);
  });

  it('treats SMTP rejection as a provider failure', async () => {
    const service = new EmailService(config as any);
    (service as any).transporter = {
      sendMail: vi.fn().mockResolvedValue({ accepted: [], rejected: ['farmer@example.test'] }),
    };

    await expect(
      service.sendAlertEmail('farmer@example.test', 'Farmer', {
        alertId: 'alert-1',
        metricName: 'oxygen',
        triggeredValue: 2.1,
        alertLevel: 'CRITICAL',
      }),
    ).rejects.toThrow('SMTP did not accept the alert email');
  });

  it('uses Nodemailer json transport in test mock mode without an SMTP connection', async () => {
    const mockConfig = {
      get: vi.fn((key: string) => ({ EMAIL_MODE: 'mock', NODE_ENV: 'test' })[key]),
    };
    const service = new EmailService(mockConfig as any);

    expect((service as any).transporter.options.jsonTransport).toBe(true);
    await expect(
      service.sendAlertEmail('farmer@example.test', 'Farmer', {
        alertId: 'alert-1',
        metricName: 'oxygen',
        triggeredValue: 2.1,
        alertLevel: 'CRITICAL',
      }),
    ).resolves.toBeUndefined();
  });
});
