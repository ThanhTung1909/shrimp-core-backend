import Redis from 'ioredis';
import { randomInt, createHash } from 'crypto';

function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return '';
  return phone.trim().replace(/\s+/g, '');
}

function hashOtp(otp) {
  return createHash('sha256').update(otp).digest('hex');
}

const verifyScript = `
    local codeKey = KEYS[1]
    local attemptsKey = KEYS[2]
    local verifiedKey = KEYS[3]

    local inputHash = ARGV[1]
    local maxAttempts = tonumber(ARGV[2])
    local verifiedTtl = tonumber(ARGV[3])

    local storedHash = redis.call('GET', codeKey)
    if not storedHash then
      return { 0, 'NOT_FOUND_OR_EXPIRED', 0 }
    end

    local currentAttempts = tonumber(redis.call('GET', attemptsKey) or '0')
    if currentAttempts >= maxAttempts then
      redis.call('DEL', codeKey, attemptsKey)
      return { 0, 'MAX_ATTEMPTS_EXCEEDED', currentAttempts }
    end

    if storedHash == inputHash then
      redis.call('DEL', codeKey, attemptsKey)
      redis.call('SET', verifiedKey, '1', 'EX', verifiedTtl)
      return { 1, 'SUCCESS', currentAttempts }
    else
      currentAttempts = redis.call('INCR', attemptsKey)
      if currentAttempts >= maxAttempts then
        redis.call('DEL', codeKey, attemptsKey)
        return { 0, 'MAX_ATTEMPTS_EXCEEDED', currentAttempts }
      end
      return { 0, 'INVALID_OTP', currentAttempts }
    end
`;

async function testOtp() {
  const client = new Redis();
  
  const phone = '0123456789';
  const normalized = normalizePhone(phone);
  const otp = randomInt(100000, 1000000).toString();
  const otpHash = hashOtp(otp);
  
  const codeKey = `otp:code:${normalized}`;
  const attemptsKey = `otp:attempts:${normalized}`;
  const verifiedKey = `otp:verified:${normalized}`;
  
  const pipeline = client.pipeline();
  pipeline.set(codeKey, otpHash, 'EX', 300);
  pipeline.set(attemptsKey, '0', 'EX', 300);
  
  await pipeline.exec();
  
  const result = await client.eval(
    verifyScript,
    3,
    codeKey,
    attemptsKey,
    verifiedKey,
    otpHash,
    5,
    600
  );
  
  console.log('Verify result:', result);
  
  await client.quit();
}

testOtp().catch(console.error);
