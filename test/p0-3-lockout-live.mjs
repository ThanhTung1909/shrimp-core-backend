// Opt-in local E2E: real HTTP + PostgreSQL + Redis; SMS mock and email stub only.
// All accounts/data are dedicated test fixtures. Credentials never enter evidence.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { randomInt, randomUUID } from 'node:crypto';
import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import bcrypt from 'bcrypt';
import { AppModule } from '../dist/app.module.js';
import { EmailService } from '../dist/modules/email/email.service.js';
import { EsmsService } from '../dist/common/esms/esms.service.js';
import { RedisService } from '../dist/common/redis/redis.service.js';
import { LoginLockoutService } from '../dist/common/redis/login-lockout.service.js';
import { OtpService } from '../dist/common/redis/otp.service.js';
import { User } from '../dist/modules/users/entities/user.entity.js';
import { UserSession } from '../dist/modules/auth/entities/user-session.entity.js';
import { Role } from '../dist/common/enums/role.enum.js';
import { TransformInterceptor } from '../dist/common/interceptors/transform.interceptor.js';
import { AllExceptionsFilter } from '../dist/common/filters/http-exception.filter.js';
import { getLoginFailKey, getLoginTempLockKey, getLoginPendingManualKey } from '../dist/common/redis/login-lockout.constants.js';
import { getOtpCodeKey, getOtpVerifiedKey, OtpPurpose } from '../dist/common/redis/otp.constants.js';

if (process.env.P03_LOCKOUT_LIVE !== '1') {
  throw new Error('Set P03_LOCKOUT_LIVE=1 to run the dedicated local lockout E2E');
}
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match && process.env[match[1]] === undefined) {
    process.env[match[1]] = match[2].replace(/^"|"$/g, '');
  }
}
// Hard boundaries: never use the ordinary local/production database or Redis port.
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '5432';
process.env.DB_NAME = 'shrimp_p03_p04_e2e_islocked';
process.env.REDIS_HOST = '127.0.0.1';
process.env.REDIS_PORT = '6380';
process.env.REDIS_DB = '0';
process.env.NODE_ENV = 'development';
process.env.SMS_MODE = 'mock';
process.env.DB_SYNCHRONIZE = 'false';

const evidence = {
  database: 'shrimp_p03_p04_e2e_islocked', redisPort: 6380,
  runId: randomUUID(),
  emailTransport: 'LOCAL_STUB_NO_SMTP', smsTransport: 'DEVELOPMENT_MOCK',
  http: {}, state: {}, accounts: [],
};
const app = await NestFactory.create(AppModule, { logger: false });
const reflector = app.get(Reflector);
app.useGlobalPipes(new ValidationPipe({
  whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true },
}));
app.useGlobalInterceptors(new ClassSerializerInterceptor(reflector), new TransformInterceptor(reflector));
app.useGlobalFilters(new AllExceptionsFilter());
const ds = app.get(DataSource);
const users = ds.getRepository(User);
const createdIds = [];
const passwords = new Map();
const mailOtps = new Map();
const smsOtps = new Map();
let redis;
let port;
let sourceAddress = 2;
let requestNumber = 0;

// Stub before app.listen initializes Redis/HTTP; never call the original transport.
app.get(EmailService).transporter.sendMail = async (options) => {
  const otp = options.text?.match(/\b(\d{6})\b/)?.[1];
  if (otp) mailOtps.set(String(options.to).trim().toLowerCase(), otp);
  return { accepted: [options.to], rejected: [], messageId: `<p03-local-${randomUUID()}@example.com>` };
};
app.get(EsmsService).sendSMS = async (phoneNumber, otp) => {
  smsOtps.set(String(phoneNumber), otp);
  return { CodeResult: '100', IsMock: true };
};

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const wrongOtp = otp => otp === '100000' ? '100001' : '100000';

async function request(name, path, { method = 'POST', body, token, ip } = {}) {
  const localAddress = ip || `127.0.0.${sourceAddress++ % 250 + 2}`;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const result = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path, method, localAddress,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, response => {
      let text = '';
      response.on('data', data => { text += data.toString('utf8'); });
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(text) }); }
        catch { reject(new Error('Invalid local HTTP response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Local HTTP timeout')));
    if (payload) req.write(payload);
    req.end();
  });
  evidence.http[name || `request${++requestNumber}`] = result.status;
  return result;
}

async function status(name, expected, path, options) {
  const response = await request(name, path, options);
  assert.equal(response.status, expected, `${name}: unexpected HTTP status`);
  return response;
}

async function seed(label, role = Role.FARMER) {
  const password = `P03@${randomUUID()}!`;
  const user = await users.save(users.create({
    fullName: `P0-3 Lockout ${label}`, phoneNumber: `09${randomInt(10000000, 100000000)}`,
    email: `p03-lockout-${label}-${randomUUID()}@example.com`, role,
    passwordHash: await bcrypt.hash(password, 10), isActive: true,
    mustChangePassword: false, isLocked: false, tokenVersion: 0,
  }));
  createdIds.push(user.userId);
  passwords.set(user.userId, password);
  evidence.accounts.push({ userId: user.userId, role });
  return user;
}

function loginBody(user, correct = true) {
  return { phoneNumber: user.phoneNumber, password: correct ? passwords.get(user.userId) : `Wrong@${randomUUID()}!` };
}

async function login(label, user) {
  const response = await status(label, 201, '/auth/login', { body: loginBody(user) });
  assert(response.body.data?.accessToken && response.body.data?.refreshToken, `${label}: missing session`);
  return response.body.data;
}

async function failures(label, user, count = 3) {
  for (let i = 1; i <= count; i++) {
    await status(`${label}${i}`, i === 3 ? 429 : 401, '/auth/login', { body: loginBody(user, false) });
  }
}

async function assertCleared(label, user) {
  const state = await app.get(LoginLockoutService).getState(user.userId);
  assert.equal(state.attempts, 0, `${label}: counter not cleared`);
  assert.equal(state.tempTtl, 0, `${label}: temporary lock not cleared`);
  evidence.state[label] = { attempts: state.attempts, tempTtl: state.tempTtl, pendingManual: state.pendingManual };
}

async function setManual(user) {
  const lockout = app.get(LoginLockoutService);
  await lockout.withUserLock(user.userId, async (current, manager) => {
    assert(current, 'Missing dedicated fixture');
    await lockout.persistManualLock(manager, current);
  });
}

async function unlock(label, actorToken, target, expected = 200) {
  return status(label, expected, `/users/${target.userId}/unlock`, {
    method: 'PATCH', token: actorToken, body: { reason: 'Dedicated P0-3 test identity verified' },
  });
}

try {
  assert.equal(ds.options.database, 'shrimp_p03_p04_e2e_islocked');
  assert.equal(ds.options.host, '127.0.0.1');
  const lockColumns = await ds.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users'
    AND column_name IN ('isLocked', 'is_login_locked', 'is_locked', 'lock_reason', 'locked_at', 'locked_by')`);
  assert.deepEqual(lockColumns.map(column => column.column_name).sort(),
    ['isLocked'], 'Unexpected legacy or missing durable lock columns');
  const isLockedColumn = ds.getMetadata(User).findColumnWithPropertyName('isLocked');
  assert.equal(isLockedColumn.databaseName, 'isLocked');
  assert.equal(isLockedColumn.isNullable, false);
  assert.equal(isLockedColumn.default, false);
  evidence.state.schema = { durableColumn: 'isLocked', nullable: false, default: false, legacyColumns: false };
  await app.listen(0, '127.0.0.1');
  port = app.getHttpServer().address().port;
  redis = app.get(RedisService).getClient();
  assert.equal(Number(redis.options.port), 6380);
  const otpService = app.get(OtpService);
  const lockout = app.get(LoginLockoutService);

  const adminA = await seed('admin-a', Role.ADMIN);
  const adminB = await seed('admin-b', Role.ADMIN);
  const managerA = await seed('manager-a', Role.MANAGER);
  const managerB = await seed('manager-b', Role.MANAGER);
  const main = await seed('main');
  const adminTokens = await login('adminLogin', adminA);
  const adminBTokens = await login('otherAdminLogin', adminB);
  const managerTokens = await login('managerLogin', managerA);
  const mainTokens = await login('mainInitialLogin', main);

  // Existing management APIs must not provide a role-escalation path around unlock.
  await status('managerCannotPromoteSelf', 403, `/users/${managerA.userId}`, {
    method: 'PATCH', token: managerTokens.accessToken, body: { role: 'ADMIN' },
  });
  const forbiddenAdminFixture = {
    fullName: 'P0-3 Forbidden ADMIN Creation', phoneNumber: `09${randomInt(10000000, 100000000)}`,
    email: `p03-forbidden-${randomUUID()}@example.com`, role: 'ADMIN',
  };
  await status('managerCannotCreateAdmin', 403, '/users', {
    token: managerTokens.accessToken,
    body: { ...forbiddenAdminFixture, password: `P03@${randomUUID()}!` },
  });
  await status('managerCannotRegisterAdmin', 403, '/auth/register', {
    token: managerTokens.accessToken, body: forbiddenAdminFixture,
  });
  assert.equal((await users.findOneByOrFail({ userId: managerA.userId })).role, Role.MANAGER);

  // Real 30-second cooldown: no EXPIRE, fake clock, or counter reset here.
  await failures('mainWrong', main);
  evidence.state.thirdFailure = {
    counter: Number(await redis.get(getLoginFailKey(main.userId))),
    counterTtl: await redis.ttl(getLoginFailKey(main.userId)),
    tempLockTtl: await redis.ttl(getLoginTempLockKey(main.userId)),
  };
  assert.equal(evidence.state.thirdFailure.counter, 3);
  assert(evidence.state.thirdFailure.counterTtl >= 895 && evidence.state.thirdFailure.counterTtl <= 900);
  assert(evidence.state.thirdFailure.tempLockTtl > 0 && evidence.state.thirdFailure.tempLockTtl <= 30);
  await status('correctDuringTempLock', 429, '/auth/login', { body: loginBody(main) });
  assert.equal(Number(await redis.get(getLoginFailKey(main.userId))), 3);
  const started = Date.now();
  await pause(31000);
  evidence.state.actualCooldownWaitMs = Date.now() - started;
  assert.equal(await redis.exists(getLoginTempLockKey(main.userId)), 0);
  assert.equal(Number(await redis.get(getLoginFailKey(main.userId))), 3);
  evidence.state.counterAfterCooldown = 3;
  await status('fourthWrong', 401, '/auth/login', { body: loginBody(main, false) });
  assert.equal(Number(await redis.get(getLoginFailKey(main.userId))), 4);
  await status('fifthWrong', 401, '/auth/login', { body: loginBody(main, false) });
  const lockedMain = await users.findOneByOrFail({ userId: main.userId });
  assert.equal(lockedMain.isLocked, true);
  assert.equal(Number(await redis.get(getLoginFailKey(main.userId))), 5);
  assert.equal(await redis.ttl(getLoginPendingManualKey(main.userId)), -1);
  evidence.state.manualLock = { isLocked: true, counter: 5, latchTtl: -1 };
  await status('correctDuringManualLock', 401, '/auth/login', { body: loginBody(main) });
  await status('oldAccessDuringManualLock', 401, '/auth/me', { method: 'GET', token: mainTokens.accessToken });
  await status('refreshDuringManualLock', 401, '/auth/refresh', { body: { refreshToken: mainTokens.refreshToken } });
  const mainSessions = await ds.getRepository(UserSession).findBy({ userId: main.userId });
  assert(mainSessions.length > 0 && mainSessions.every(session => session.revokedAt));
  evidence.state.lockRevokedSessions = true;
  // Clear only this fixture's Redis state to prove PostgreSQL still denies login.
  // This is never FLUSHDB/FLUSHALL or deletion of unrelated keys.
  await lockout.resetLoginFailureState(main.userId, 'TEST_REDIS_STATE_LOSS', true);
  await status('persistentLockAfterRedisStateLoss', 401, '/auth/login', { body: loginBody(main) });
  assert.equal((await users.findOneByOrFail({ userId: main.userId })).isLocked, true);
  await unlock('adminUnlockMain', adminTokens.accessToken, main);
  await assertCleared('mainAfterUnlock', main);
  await status('oldAccessAfterUnlock', 401, '/auth/me', { method: 'GET', token: mainTokens.accessToken });
  await status('oldRefreshAfterUnlock', 401, '/auth/refresh', { body: { refreshToken: mainTokens.refreshToken } });
  await login('mainNewLoginAfterUnlock', main);

  // Full permission matrix. These are new test-only ADMIN/MANAGER fixtures.
  await setManual(adminB);
  await status('managerCannotDowngradeLockedAdmin', 403, `/users/${adminB.userId}`, {
    method: 'PATCH', token: managerTokens.accessToken, body: { role: 'FARMER' },
  });
  await unlock('adminUnlockOtherAdmin', adminTokens.accessToken, adminB);
  await setManual(managerB);
  await unlock('adminUnlockManager', adminTokens.accessToken, managerB);
  await setManual(managerB);
  await unlock('managerUnlockOtherManager', managerTokens.accessToken, managerB);
  const matrixFarmer = await seed('matrix-farmer');
  const farmerTokens = await login('farmerInitialLogin', matrixFarmer);
  await setManual(matrixFarmer);
  await unlock('managerUnlockFarmer', managerTokens.accessToken, matrixFarmer);
  await unlock('managerCannotUnlockAdmin', managerTokens.accessToken, adminB, 403);
  await unlock('adminCannotUnlockSelf', adminTokens.accessToken, adminA, 403);
  await unlock('managerCannotUnlockSelf', managerTokens.accessToken, managerA, 403);
  // FARMER has a current session after the preceding manual lock revoked its old one.
  const newFarmerTokens = await login('farmerLoginAfterUnlock', matrixFarmer);
  await unlock('farmerCannotUnlockAnyone', newFarmerTokens.accessToken, managerB, 403);
  await setManual(adminB);
  await unlock('lockedActorCannotUnlock', adminBTokens.accessToken, matrixFarmer, 401);
  await status('farmerOldTokenStillRevoked', 401, '/auth/me', { method: 'GET', token: farmerTokens.accessToken });

  const passwordSuccess = await seed('password-success');
  await failures('passwordSuccessWrong', passwordSuccess, 2);
  await login('passwordSuccess', passwordSuccess);
  await assertCleared('passwordSuccessCleared', passwordSuccess);

  // OTP LOGIN clears a temporary lock only after OTP + session creation succeed.
  const otpUser = await seed('otp-login');
  await failures('otpLoginWrongPassword', otpUser);
  const otpLogin = await otpService.createAndSaveOtp(OtpPurpose.LOGIN, otpUser.phoneNumber);
  await status('otpLoginWrongOtp', 400, '/auth/verify-otp', {
    body: { phoneNumber: otpUser.phoneNumber, purpose: 'LOGIN', otp: wrongOtp(otpLogin.otp) },
  });
  assert.equal(Number(await redis.get(getLoginFailKey(otpUser.userId))), 3);
  const otpTokens = await status('otpLoginCorrect', 201, '/auth/verify-otp', {
    body: { phoneNumber: otpUser.phoneNumber, purpose: 'LOGIN', otp: otpLogin.otp },
  });
  assert(otpTokens.body.data?.accessToken);
  await assertCleared('otpLoginCleared', otpUser);
  assert.equal(await redis.exists(getOtpCodeKey(OtpPurpose.LOGIN, otpUser.phoneNumber)), 0);
  assert.equal(await redis.exists(getOtpVerifiedKey(OtpPurpose.LOGIN, otpUser.phoneNumber)), 0);
  await status('otpLoginCannotReuse', 400, '/auth/verify-otp', {
    body: { phoneNumber: otpUser.phoneNumber, purpose: 'LOGIN', otp: otpLogin.otp },
  });
  const manualOtpUser = await seed('manual-otp');
  await setManual(manualOtpUser);
  const manualOtp = await otpService.createAndSaveOtp(OtpPurpose.LOGIN, manualOtpUser.phoneNumber);
  const sessionsBefore = await ds.getRepository(UserSession).countBy({ userId: manualOtpUser.userId });
  await status('otpLoginCannotBypassManualLock', 401, '/auth/verify-otp', {
    body: { phoneNumber: manualOtpUser.phoneNumber, purpose: 'LOGIN', otp: manualOtp.otp },
  });
  assert.equal(await ds.getRepository(UserSession).countBy({ userId: manualOtpUser.userId }), sessionsBefore);
  assert.equal((await users.findOneByOrFail({ userId: manualOtpUser.userId })).isLocked, true);

  // Authenticated password change checks old password and OTP before clearing state.
  const changeUser = await seed('change-password');
  const changeTokens = await login('changeInitialLogin', changeUser);
  await failures('changeWrongPassword', changeUser);
  const changeOtp = await otpService.createAndSaveOtp(OtpPurpose.CHANGE_PASSWORD, changeUser.phoneNumber);
  const changedPassword = `Changed@${randomUUID()}!`;
  await status('changeWrongOldPassword', 401, '/auth/change-password', {
    token: changeTokens.accessToken,
    body: { currentPassword: `Wrong@${randomUUID()}!`, newPassword: changedPassword, otp: changeOtp.otp },
  });
  assert.equal(Number(await redis.get(getLoginFailKey(changeUser.userId))), 3);
  await status('changePasswordCorrect', 201, '/auth/change-password', {
    token: changeTokens.accessToken,
    body: { currentPassword: passwords.get(changeUser.userId), newPassword: changedPassword,
      otp: changeOtp.otp, refreshToken: changeTokens.refreshToken },
  });
  passwords.set(changeUser.userId, changedPassword);
  await assertCleared('changePasswordCleared', changeUser);
  await status('changeOldAccessRevoked', 401, '/auth/me', { method: 'GET', token: changeTokens.accessToken });
  await login('changeNewPasswordLogin', changeUser);

  // Forgot/reset uses the real email/SMS contracts; delivery is stub/mock only.
  for (const channel of ['email', 'sms']) {
    const recoveryUser = await seed(`${channel}-recovery`);
    await failures(`${channel}RecoveryWrongPassword`, recoveryUser);
    await status(`${channel}ResetWithoutMarker`, 401, '/auth/reset-password', {
      body: { ...(channel === 'email' ? { email: recoveryUser.email } : { phoneNumber: recoveryUser.phoneNumber }),
        newPassword: `Missing@${randomUUID()}!` },
    });
    assert.equal(Number(await redis.get(getLoginFailKey(recoveryUser.userId))), 3);
    const identifierBody = channel === 'email' ? { email: recoveryUser.email } : { phoneNumber: recoveryUser.phoneNumber };
    const forgot = await status(`${channel}Forgot`, 201, '/auth/forgot-password', { body: identifierBody });
    const otp = channel === 'email'
      ? mailOtps.get(recoveryUser.email)
      : smsOtps.get(recoveryUser.phoneNumber);
    assert(otp, `${channel}: missing local test OTP`);
    if (channel === 'email') assert.equal(forgot.body.data?.otp, undefined);
    await status(`${channel}RecoveryVerify`, 201, '/auth/verify-otp', {
      body: { ...identifierBody, purpose: 'RESET_PASSWORD', otp },
    });
    const nextPassword = `Recovered@${randomUUID()}!`;
    await status(`${channel}RecoveryReset`, 201, '/auth/reset-password', {
      body: { ...identifierBody, newPassword: nextPassword },
    });
    passwords.set(recoveryUser.userId, nextPassword);
    await assertCleared(`${channel}RecoveryCleared`, recoveryUser);
    await status(`${channel}RecoveryMarkerReuse`, 401, '/auth/reset-password', {
      body: { ...identifierBody, newPassword: nextPassword },
    });
    await login(`${channel}RecoveredLogin`, recoveryUser);
  }

  const manualRecovery = await seed('manual-recovery');
  await failures('manualRecoveryWrong', manualRecovery);
  await setManual(manualRecovery);
  const manualResetOtp = await otpService.createAndSaveOtp(OtpPurpose.RESET_PASSWORD, manualRecovery.phoneNumber);
  await status('manualRecoveryVerify', 201, '/auth/verify-otp', {
    body: { phoneNumber: manualRecovery.phoneNumber, purpose: 'RESET_PASSWORD', otp: manualResetOtp.otp },
  });
  const manualNewPassword = `Recovered@${randomUUID()}!`;
  await status('manualRecoveryReset', 201, '/auth/reset-password', {
    body: { phoneNumber: manualRecovery.phoneNumber, newPassword: manualNewPassword },
  });
  passwords.set(manualRecovery.userId, manualNewPassword);
  await assertCleared('manualRecoveryCounterCleared', manualRecovery);
  const stillLocked = await users.findOneByOrFail({ userId: manualRecovery.userId });
  assert.equal(stillLocked.isLocked, true);
  await status('manualRecoveryStillCannotLogin', 401, '/auth/login', { body: loginBody(manualRecovery) });

  // Concurrent requests all reach the actual auth flow; each uses a separate IP budget.
  const parallel = await seed('parallel');
  const parallelResponses = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    request(`parallelWrong${i + 1}`, '/auth/login', { body: loginBody(parallel, false) })));
  assert.equal(parallelResponses.filter(response => response.status === 401).length, 2);
  assert.equal(parallelResponses.filter(response => response.status === 429).length, 18);
  assert.equal(Number(await redis.get(getLoginFailKey(parallel.userId))), 3);
  evidence.state.parallel = { requests: 20, unauthorized: 2, temporaryLock: 18, counter: 3 };

  const racing = await seed('unlock-race');
  await setManual(racing);
  const [unlockRace, loginRace] = await Promise.all([
    request('raceUnlock', `/users/${racing.userId}/unlock`, {
      method: 'PATCH', token: adminTokens.accessToken, body: { reason: 'Dedicated race test' },
    }),
    request('raceWrongLogin', '/auth/login', { body: loginBody(racing, false) }),
  ]);
  assert.equal(unlockRace.status, 200);
  assert.equal(loginRace.status, 401);
  const raceState = await lockout.getState(racing.userId);
  assert(raceState.attempts === 0 || raceState.attempts === 1);
  assert.equal(raceState.pendingManual, false);
  assert.equal((await users.findOneByOrFail({ userId: racing.userId })).isLocked, false);
  evidence.state.unlockLoginRace = { attempts: raceState.attempts, pendingManual: false, isLocked: false };
  await login('raceNewLogin', racing);

  const windowUser = await seed('sliding-window');
  await failures('windowFirstWrong', windowUser, 1);
  const firstTtl = await redis.ttl(getLoginFailKey(windowUser.userId));
  await pause(1200);
  const agedTtl = await redis.ttl(getLoginFailKey(windowUser.userId));
  await failures('windowSecondWrong', windowUser, 1);
  const renewedTtl = await redis.ttl(getLoginFailKey(windowUser.userId));
  assert.equal(Number(await redis.get(getLoginFailKey(windowUser.userId))), 2);
  assert(agedTtl < firstTtl && renewedTtl > agedTtl && renewedTtl <= 900);
  evidence.state.slidingWindow = { firstTtl, agedTtl, renewedTtl, counter: 2 };

  const logoutUser = await seed('logout-refresh');
  const logoutTokens = await login('logoutInitialLogin', logoutUser);
  const refresh = await status('refreshRotation', 201, '/auth/refresh', { body: { refreshToken: logoutTokens.refreshToken } });
  assert(refresh.body.data?.refreshToken);
  await status('logoutMeBefore', 200, '/auth/me', { method: 'GET', token: refresh.body.data.accessToken });
  await status('logout', 201, '/auth/logout', {
    body: { refreshToken: refresh.body.data.refreshToken }, token: refresh.body.data.accessToken,
  });
  const claims = JSON.parse(Buffer.from(refresh.body.data.accessToken.split('.')[1], 'base64url').toString());
  const blacklistTtl = await redis.ttl(`auth:blacklist:access:${claims.jti}`);
  assert(blacklistTtl > 0);
  evidence.state.blacklistTtl = blacklistTtl;
  await status('logoutOldAccessDenied', 401, '/auth/me', { method: 'GET', token: refresh.body.data.accessToken });
  await status('logoutOldRefreshDenied', 401, '/auth/refresh', { body: { refreshToken: refresh.body.data.refreshToken } });
  await status('refreshReuseDenied', 401, '/auth/refresh', { body: { refreshToken: logoutTokens.refreshToken } });

  const refreshRaceUser = await seed('refresh-race');
  const refreshRaceTokens = await login('refreshRaceInitialLogin', refreshRaceUser);
  const refreshRace = await Promise.all([
    request('refreshRaceA', '/auth/refresh', { body: { refreshToken: refreshRaceTokens.refreshToken } }),
    request('refreshRaceB', '/auth/refresh', { body: { refreshToken: refreshRaceTokens.refreshToken } }),
  ]);
  assert.equal(refreshRace.filter(response => response.status === 201).length, 1);
  assert.equal(refreshRace.filter(response => response.status === 401).length, 1);
  const issuedRefresh = refreshRace.find(response => response.status === 201).body.data?.refreshToken;
  assert(issuedRefresh, 'Missing rotated test refresh token');
  await status('refreshRaceFamilyRevoked', 401, '/auth/refresh', { body: { refreshToken: issuedRefresh } });
  const refreshRaceSessions = await ds.getRepository(UserSession).findBy({ userId: refreshRaceUser.userId });
  assert(refreshRaceSessions.length >= 2 && refreshRaceSessions.every(session => session.revokedAt));
  evidence.state.concurrentRefresh = { successful: 1, rejected: 1, familyRevoked: true };

  // Controller IP rate limiting remains live and is not bypassed by the harness.
  const rateIp = '127.0.0.250';
  const rateUser = await seed('ip-rate');
  for (let i = 1; i <= 10; i++) {
    await status(`rateAllowed${i}`, 201, '/auth/login', { body: loginBody(rateUser), ip: rateIp });
  }
  await status('ipRateEleventhDenied', 429, '/auth/login', { body: loginBody(rateUser), ip: rateIp });

  await status('managerUsersList', 200, '/users', { method: 'GET', token: managerTokens.accessToken });
  await status('managerUsersDetails', 200, `/users/${main.userId}`, { method: 'GET', token: managerTokens.accessToken });
  const managedCreate = await status('managerCreateFarmer', 201, '/users', {
    token: managerTokens.accessToken,
    body: { fullName: 'P0-3 Managed FARMER', phoneNumber: `09${randomInt(10000000, 100000000)}`,
      role: 'FARMER', password: `P03@${randomUUID()}!`, mustChangePassword: false },
  });
  const managedUserId = managedCreate.body.data?.user?.userId;
  assert(managedUserId, 'Managed test user missing');
  createdIds.push(managedUserId);
  evidence.accounts.push({ userId: managedUserId, role: Role.FARMER });
  await status('managerUpdateFarmer', 200, `/users/${managedUserId}`, {
    method: 'PATCH', token: managerTokens.accessToken, body: { fullName: 'P0-3 Managed FARMER Updated' },
  });
  evidence.result = 'LOCAL_HTTP_POSTGRES_REDIS_E2E_PASS';
  evidence.emailDelivery = 'NOT_TESTED_LOCAL_STUB';
} catch (error) {
  evidence.result = 'FAILED_OR_BLOCKED';
  // Never serialize response/provider objects or assertion values containing secrets.
  evidence.failure = error instanceof assert.AssertionError
    ? error.message.split('\n')[0]
    : error.code || error.name || 'Error';
  process.exitCode = 1;
} finally {
  if (createdIds.length > 0) {
    await users.update({ userId: In(createdIds) }, { isActive: false });
    evidence.createdTestAccountsLeftInactive = createdIds.length;
  }
  await app.close();
  evidence.exitCode = process.exitCode || 0;
  const evidencePath = 'test/evidence/p0-3-lockout-live.evidence.json';
  fs.mkdirSync('test/evidence', { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
}
