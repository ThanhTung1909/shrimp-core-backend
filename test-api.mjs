import http from 'http';
import Redis from 'ioredis';
import { createHash } from 'crypto';

function hashOtp(otp) {
  return createHash('sha256').update(otp).digest('hex');
}

function makeRequest(path, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: 3000,
        path: path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(JSON.stringify(data)),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body || '{}') }));
      }
    );
    req.on('error', reject);
    req.write(JSON.stringify(data));
    req.end();
  });
}

async function runTest() {
  const phone = '0987654321';
  
  // 1. Send OTP
  console.log('--- Sending OTP ---');
  const sendRes = await makeRequest('/auth/send-otp', {
    phoneNumber: phone,
    purpose: 'LOGIN',
  });
  
  const client = new Redis({ port: 6380 });
  const storedHash = await client.get(`otp:code:${phone}`);
  
  let foundOtp = null;
  for (let i = 100000; i <= 999999; i++) {
    if (hashOtp(i.toString()) === storedHash) {
      foundOtp = i.toString();
      break;
    }
  }
  
  // 2. Verify OTP with NUMBER
  console.log('--- Verifying OTP with NUMBER ---');
  const verifyRes = await makeRequest('/auth/verify-otp', {
    phoneNumber: phone,
    otp: parseInt(foundOtp),
  });
  console.log(verifyRes);
  
  await client.quit();
}

runTest().catch(console.error);
