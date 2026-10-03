import Redis from 'ioredis';

async function listKeys() {
  const client = new Redis({ port: 6380 });
  const keys = await client.keys('*');
  console.log('Keys in Redis 6380:', keys);
  await client.quit();
}
listKeys().catch(console.error);
