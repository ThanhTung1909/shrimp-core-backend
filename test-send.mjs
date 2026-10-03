import http from 'http';
import Redis from 'ioredis';

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
  console.log(sendRes);
  
  const client = new Redis();
  const keys = await client.keys('*');
  console.log('All keys:', keys);
  
  const storedHash = await client.get(`otp:code:${phone}`);
  console.log('Stored hash from redis:', storedHash);
  
  await client.quit();
}

runTest().catch(console.error);
