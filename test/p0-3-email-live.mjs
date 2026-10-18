// Opt-in live HTTP + Postgres + Redis + existing SMTP verification.
// Uses a dedicated FARMER account. Never prints passwords, tokens, or OTPs.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import tls from 'node:tls';
import { randomInt, randomUUID } from 'node:crypto';
import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import bcrypt from 'bcrypt';
import { AppModule } from '../dist/app.module.js';
import { EmailService } from '../dist/modules/email/email.service.js';
import { RedisService } from '../dist/common/redis/redis.service.js';
import { OtpService } from '../dist/common/redis/otp.service.js';
import { User } from '../dist/modules/users/entities/user.entity.js';
import { Role } from '../dist/common/enums/role.enum.js';
import { TransformInterceptor } from '../dist/common/interceptors/transform.interceptor.js';
import { AllExceptionsFilter } from '../dist/common/filters/http-exception.filter.js';
import { getOtpCodeKey, getOtpVerifiedKey, getEmailOtpIdentifier, OtpPurpose } from '../dist/common/redis/otp.constants.js';

const httpOnly = process.env.P03_HTTP_ONLY === '1';
if (!httpOnly && process.env.P03_LIVE_EMAIL !== '1') throw new Error('Set P03_LIVE_EMAIL=1 for live mailbox testing or P03_HTTP_ONLY=1 for local HTTP testing');
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^"|"$/g, '');
}
process.env.NODE_ENV = 'development';
process.env.SMS_MODE = 'mock';
process.env.DB_SYNCHRONIZE = 'false';
process.env.REDIS_PORT = '6390';
const emailAddress = httpOnly
  ? `p03-http-${randomUUID()}@example.com`
  : process.env.EMAIL_USER?.trim().toLowerCase();
assert(emailAddress && (httpOnly || process.env.EMAIL_PASS), 'BLOCKED: missing configured email test credentials');

async function connectMailbox() {
  if (process.env.EMAIL_HOST !== 'smtp.gmail.com') throw new Error('BLOCKED: no supported test mailbox access configuration');
  const socket = tls.connect({ host: 'imap.gmail.com', port: 993, servername: 'imap.gmail.com' });
  let buffer = '';
  socket.on('data', data => { buffer += data.toString('utf8'); });
  // Keep socket errors scoped to this optional receipt verification.
  let socketError;
  socket.on('error', error => { socketError = error; });
  const until = async (predicate, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (socketError) throw socketError;
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('BLOCKED: mailbox timeout');
  };
  let seq = 0;
  const command = async (text) => {
    const tag = `P${++seq}`;
    const start = buffer.length;
    socket.write(`${tag} ${text}\r\n`);
    await until(() => new RegExp(`(?:^|\\r\\n)${tag} (?:OK|NO|BAD)`).test(buffer.slice(start)));
    const result = buffer.slice(start);
    if (!new RegExp(`(?:^|\\r\\n)${tag} OK`).test(result)) throw new Error('BLOCKED: mailbox rejected request');
    return result;
  };
  const quote = value => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  try {
    await until(() => buffer.includes('* OK'));
    await command(`LOGIN ${quote(emailAddress)} ${quote(process.env.EMAIL_PASS)}`);
    await command('EXAMINE INBOX');
    return {
      async readOtp(messageId) {
        for (let i = 0; i < 15; i++) {
          const result = await command(`UID SEARCH HEADER Message-ID ${quote(messageId)}`);
          const uid = result.match(/\* SEARCH (\d+)/)?.[1];
          if (uid) {
            const raw = await command(`UID FETCH ${uid} (BODY.PEEK[])`);
            const literal = raw.match(/BODY\[\] \{\d+\}\r\n([\s\S]*)/i)?.[1];
            assert(literal, 'Missing email body');
            const boundary = literal.indexOf('\r\n\r\n');
            const headers = literal.slice(0, boundary);
            let body = literal.slice(boundary + 4);
            if (/Content-Transfer-Encoding: base64/i.test(headers)) body = Buffer.from(body.split(/\r\n\)/)[0].replace(/\s/g, ''), 'base64').toString('utf8');
            else body = body.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
            const otp = body.match(/\b(\d{6})\b/)?.[1];
            assert(otp, 'Missing OTP in received email');
            return otp;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        throw new Error('BLOCKED: test email not observed in inbox');
      },
      close() { socket.end(); },
    };
  } catch (error) { socket.destroy(); throw error; }
}

const evidence = { http: {}, mailboxReceipt: 'BLOCKED', smtpAccepted: false, emailTransport: httpOnly ? 'LOCAL_STUB' : 'EXISTING_SMTP' };
let mailbox;
if (!httpOnly) {
  try { mailbox = await connectMailbox(); } catch { evidence.mailboxReceipt = 'BLOCKED: IMAP test inbox access unavailable'; }
}
const app = await NestFactory.create(AppModule, { logger: false });
const reflector = app.get(Reflector);
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
app.useGlobalInterceptors(new ClassSerializerInterceptor(reflector), new TransformInterceptor(reflector));
app.useGlobalFilters(new AllExceptionsFilter());
let createdUser;
try {
  const ds = app.get(DataSource);
  const users = ds.getRepository(User);
  const existing = await users.createQueryBuilder('u').where('LOWER(TRIM(u.email)) = :email', { email: emailAddress }).getCount();
  assert.equal(existing, 0, 'BLOCKED: configured mailbox belongs to an existing account; no existing password will be changed');
  const phone = `09${randomInt(10000000, 100000000)}`;
  const newPassword = `P03@${randomUUID()}!`;
  createdUser = await users.save(users.create({ fullName: 'P0-3 Email OTP Live Test', phoneNumber: phone, email: emailAddress, role: Role.FARMER, isActive: true, passwordHash: await bcrypt.hash(randomUUID(), 10), mustChangePassword: false }));
  evidence.testAccount = { userId: createdUser.userId, phoneNumber: phone, role: createdUser.role };
  const email = app.get(EmailService);
  const original = email.transporter.sendMail.bind(email.transporter);
  let capturedOtp;
  let messageId;
  let deliveryError;
  email.transporter.sendMail = async (options) => {
    capturedOtp = options.text.match(/\b(\d{6})\b/)?.[1];
    try {
      if (httpOnly) {
        messageId = `<p03-local-${randomUUID()}@example.com>`;
        return { accepted: [emailAddress], rejected: [], messageId };
      }
      const result = await original(options);
      evidence.smtpAccepted = result.accepted?.length > 0 && !result.rejected?.length;
      messageId = result.messageId;
      return result;
    } catch (error) { deliveryError = error; throw error; }
  };
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  async function request(name, path, body, token) {
    const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    evidence.http[name] = response.status;
    return { status: response.status, body: await response.json() };
  }
  const forgot = await request('emailForgot', '/auth/forgot-password', { email: ` ${emailAddress.toUpperCase()} ` });
  assert.equal(forgot.status, 201);
  assert.equal(forgot.body.data?.otp, undefined);
  const deadline = Date.now() + 30000;
  while (!messageId && !deliveryError && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert(httpOnly || evidence.smtpAccepted, 'BLOCKED: SMTP did not accept test email');
  let otp = capturedOtp;
  if (mailbox) {
    try { otp = await mailbox.readOtp(messageId); assert.equal(otp, capturedOtp); evidence.mailboxReceipt = 'VERIFIED'; }
    catch { evidence.mailboxReceipt = 'BLOCKED: receipt could not be verified'; }
  }
  const redis = app.get(RedisService).getClient();
  const identifier = getEmailOtpIdentifier(emailAddress);
  const codeKey = getOtpCodeKey(OtpPurpose.RESET_PASSWORD, identifier);
  evidence.otpTtl = await redis.ttl(codeKey);
  evidence.otpStoredAsHash = /^[a-f0-9]{64}$/.test(await redis.get(codeKey));
  const verifyBody = { email: emailAddress, purpose: 'RESET_PASSWORD' };
  assert.equal((await request('wrongOtp', '/auth/verify-otp', { ...verifyBody, otp: otp === '100000' ? '100001' : '100000' })).status, 400);
  assert.equal((await request('correctOtp', '/auth/verify-otp', { ...verifyBody, otp })).status, 201);
  evidence.verifiedTtl = await redis.ttl(getOtpVerifiedKey(OtpPurpose.RESET_PASSWORD, identifier));
  assert.equal((await request('otpReuse', '/auth/verify-otp', { ...verifyBody, otp })).status, 400);
  assert.equal((await request('emailReset', '/auth/reset-password', { email: emailAddress, newPassword })).status, 201);
  assert.equal((await request('resetReuse', '/auth/reset-password', { email: emailAddress, newPassword })).status, 401);
  const login = await request('loginNewPassword', '/auth/login', { phoneNumber: phone, password: newPassword });
  assert.equal(login.status, 201);
  const { accessToken, refreshToken } = login.body.data;
  assert.equal((await request('meBeforeLogout', '/auth/me', undefined, accessToken)).status, 200);
  assert.equal((await request('logout', '/auth/logout', { refreshToken }, accessToken)).status, 201);
  const claims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString());
  evidence.blacklistTtl = await redis.ttl(`auth:blacklist:access:${claims.jti}`);
  assert.equal((await request('oldAccessToken', '/auth/me', undefined, accessToken)).status, 401);
  const sms = await request('smsForgot', '/auth/forgot-password', { phoneNumber: phone });
  assert.equal(sms.status, 201);
  assert.equal((await request('smsVerify', '/auth/verify-otp', { phoneNumber: phone, otp: sms.body.data.otp, purpose: 'RESET_PASSWORD' })).status, 201);
  assert.equal((await request('smsReset', '/auth/reset-password', { phoneNumber: phone, newPassword })).status, 201);
  // Expiry uses only a unique test-owned email identity; no existing Redis key is deleted.
  const expiryEmail = `p03-expiry-${randomUUID()}@example.com`;
  const expired = await app.get(OtpService).createAndSaveOtp(OtpPurpose.RESET_PASSWORD, getEmailOtpIdentifier(expiryEmail), 1);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal((await request('expiredEmailOtp', '/auth/verify-otp', { email: expiryEmail, otp: expired.otp, purpose: 'RESET_PASSWORD' })).status, 400);
  evidence.result = evidence.mailboxReceipt === 'VERIFIED'
    ? 'E2E_PASS'
    : httpOnly
      ? 'PARTIAL: local HTTP/DB/Redis verified; real email delivery BLOCKED'
      : 'PARTIAL: SMTP and HTTP/DB/Redis verified; inbox receipt BLOCKED';
} catch (error) {
  evidence.result = 'FAILED_OR_BLOCKED';
  // Do not serialize provider errors because they may contain recipient/message content.
  evidence.failure = error instanceof assert.AssertionError ? error.message.split('\n')[0] : error.code || error.name;
  process.exitCode = 1;
} finally {
  if (createdUser) {
    // Preserve test evidence; leave the new test account inactive, never touch ADMIN.
    await app.get(DataSource).getRepository(User).update(createdUser.userId, { isActive: false });
    evidence.testAccountLeftInactive = true;
  }
  mailbox?.close();
  await app.close();
  console.log(JSON.stringify(evidence, null, 2));
}
