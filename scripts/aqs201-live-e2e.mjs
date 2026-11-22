import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');
const dotenv = require('dotenv');
const mqtt = require('mqtt');
const root = resolve(import.meta.dirname, '..');
const env = dotenv.parse(readFileSync('D:\\Khóa Luận\\Project\\shrimp-core-backend\\.env'));
if (env.DB_HOST !== 'localhost' || env.DB_PORT !== '5432' || env.DB_NAME !== 'shrimp_local_db') throw new Error('Refusing DB outside approved endpoint');
const entityFiles = readdirSync(join(root, 'dist/modules'), { recursive: true }).filter((f) => typeof f === 'string' && f.includes('entities') && f.endsWith('.entity.js'));
const entities = (await Promise.all(entityFiles.map(async (f) => Object.values(await import(pathToFileURL(join(root, 'dist/modules', f)).href)).filter((v) => typeof v === 'function')))).flat();
const load = (p) => import(pathToFileURL(join(root, 'dist', p)).href);
const [{ TelemetryService }, { TelemetryMqttService }, { Device }, { TelemetryData }, { TelemetryIngestReceipt }, { Alert }, { ThresholdConfig }] = await Promise.all([
  load('modules/telemetry/telemetry.service.js'), load('modules/telemetry/telemetry-mqtt.service.js'), load('modules/devices/entities/device.entity.js'), load('modules/telemetry/entities/telemetry-data.entity.js'), load('modules/telemetry/entities/telemetry-ingest-receipt.entity.js'), load('modules/alerts/entities/alert.entity.js'), load('modules/ponds/entities/threshold-config.entity.js'),
]);
const id = { runId: randomUUID(), userId: randomUUID(), pondId: randomUUID(), deviceId: randomUUID() };
const manifestPath = `C:\\AquaSense-Backups\\AQS-201\\aqs201-live-fixture-${id.runId}.json`;
writeFileSync(manifestPath, JSON.stringify({ ...id, ownership: 'AQS201_TEST_ONLY', createdAt: new Date().toISOString() }, null, 2));
const ds = new DataSource({ type: 'postgres', host: env.DB_HOST, port: +env.DB_PORT, username: env.DB_USER, password: env.DB_PASS, database: env.DB_NAME, entities, synchronize: false });
let pub; let ingress; let createdAlerts = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const connected = async (c) => { if (!c.connected) await once(c, 'connect'); };
const ack = (c, ackTopic, topic, payload) => new Promise((resolveAck, rejectAck) => {
  const timer = setTimeout(() => rejectAck(new Error(`ACK timeout: ${payload.messageId}`)), 10000);
  const onMessage = (receivedTopic, buffer) => { if (receivedTopic === ackTopic) { const x = JSON.parse(buffer); if (x.messageId === payload.messageId) { clearTimeout(timer); c.off('message', onMessage); resolveAck(x); } } };
  c.on('message', onMessage); c.publish(topic, JSON.stringify(payload), { qos: 1 }, (e) => { if (e) { clearTimeout(timer); c.off('message', onMessage); rejectAck(e); } });
});
try {
  await ds.initialize();
  const deviceRepo = ds.getRepository(Device), telemetryRepo = ds.getRepository(TelemetryData), receiptRepo = ds.getRepository(TelemetryIngestReceipt), alertRepo = ds.getRepository(Alert), thresholdRepo = ds.getRepository(ThresholdConfig);
  const short = id.runId.replaceAll('-', '').slice(0, 16), phone = `9${Date.now().toString().slice(-10)}`;
  await ds.query(`INSERT INTO users(user_id,full_name,phone_number,email,password_hash,role,is_active,"isLocked",must_change_password,token_version) VALUES($1,$2,$3,$4,$5,'FARMER',false,true,true,0)`, [id.userId, `AQS201_TEST_ONLY_${short}`, phone, `aqs201.${short}@example.invalid`, 'TEST_ONLY_NOT_A_LOGIN']);
  await ds.query(`INSERT INTO pond(pond_id,user_id,pond_name,location,area_m2,depth_m,shrimp_density,status) VALUES($1,$2,$3,'TEST_ONLY',1,1,1,'EMPTY')`, [id.pondId, id.userId, `AQS201_TEST_ONLY_${short}`]);
  await ds.query(`INSERT INTO device(device_id,pond_id,device_name,mac_address,firmware_version,status) VALUES($1,$2,$3,$4,'TEST_ONLY','MAINTENANCE')`, [id.deviceId, id.pondId, `AQS201_TEST_ONLY_${short}`, `AQS201-${short}`]);
  for (const [metric, min, max] of [['pH', 6.5, 8.5], ['DO', 4, 8], ['temperature', 20, 32]]) await ds.query(`INSERT INTO threshold_config(config_id,pond_id,metric_name,min_value,max_value,is_active) VALUES($1,$2,$3,$4,$5,true)`, [randomUUID(), id.pondId, metric, min, max]);
  const redis = { get: async () => null, set: async () => 'OK', publish: async () => 1, reserveAlertCooldown: async () => 'created', del: async () => 1 };
  const alertsService = { createThresholdAlert: async (input) => { createdAlerts++; return alertRepo.save(alertRepo.create({ pondId: input.pondId, deviceId: input.deviceId, metricName: input.metricName, triggeredValue: input.triggeredValue, alertLevel: input.alertLevel, status: 'ACTIVE', message: 'AQS201_TEST_ONLY unexpected alert' })); } };
  const service = new TelemetryService(telemetryRepo, deviceRepo, alertRepo, thresholdRepo, ds, alertsService, redis);
  await deviceRepo.update(id.deviceId, { status: 'ONLINE' });
  let release; let observed; const gate = new Promise((r) => { release = r; }), outer = new Promise((r) => { observed = r; });
  const raceRepo = new Proxy(deviceRepo, { get(target, prop, receiver) { if (prop === 'findOne') return async (...args) => { const row = await target.findOne(...args); observed(); await gate; return row; }; return Reflect.get(target, prop, receiver); } });
  const racer = new TelemetryService(telemetryRepo, raceRepo, alertRepo, thresholdRepo, ds, alertsService, redis);
  const racePayload = { deviceId: id.deviceId, messageId: `AQS201-RACE-${short}`, ph: 4, recordedAt: new Date().toISOString() };
  const raceRun = racer.processTelemetryPayloadWithAck(racePayload); await outer; await deviceRepo.update(id.deviceId, { status: 'MAINTENANCE' }); release(); await raceRun;
  const raceRow = await telemetryRepo.findOneByOrFail({ deviceId: id.deviceId, messageId: racePayload.messageId });
  if (!raceRow.isMaintenance || (await deviceRepo.findOneByOrFail({ deviceId: id.deviceId })).status !== 'MAINTENANCE') throw new Error('TOCTOU invariant failed');
  ingress = new TelemetryMqttService({ get: (key) => key === 'MQTT_BROKER_URL' ? env.MQTT_BROKER_URL : undefined }, service); ingress.onModuleInit(); await connected(ingress.client); await wait(300);
  pub = mqtt.connect(env.MQTT_BROKER_URL, { reconnectPeriod: 0, connectTimeout: 10000 }); await connected(pub);
  const ackTopic = `telemetry/devices/${id.deviceId}/ack`, topic = `telemetry/devices/${id.deviceId}/data`; await new Promise((r, j) => pub.subscribe(ackTopic, { qos: 1 }, (e) => e ? j(e) : r()));
  const rows = [{ messageId: `AQS201-PH-${short}`, ph: 4 }, { messageId: `AQS201-DO-${short}`, dissolvedOxygen: 1 }, { messageId: `AQS201-TEMP-${short}`, temperature: 42 }].map((x) => ({ ...x, deviceId: id.deviceId, recordedAt: new Date().toISOString() }));
  const acks = []; for (const row of rows) acks.push(await ack(pub, ackTopic, topic, row)); const duplicate = await ack(pub, ackTopic, topic, rows[0]);
  const maintenanceRows = await telemetryRepo.countBy({ deviceId: id.deviceId, isMaintenance: true }), receipts = await receiptRepo.countBy({ deviceId: id.deviceId }), alerts = await alertRepo.countBy({ deviceId: id.deviceId }), latest = await service.getLatestByDeviceId(id.deviceId), status = (await deviceRepo.findOneByOrFail({ deviceId: id.deviceId })).status;
  if (acks.some((x) => x.status !== 'stored') || duplicate.status !== 'duplicate' || maintenanceRows !== 4 || receipts !== 4 || createdAlerts !== 0 || alerts !== 0 || latest !== null || status !== 'MAINTENANCE') throw new Error(`E2E assertion failed: ${JSON.stringify({ acks, duplicate, maintenanceRows, receipts, createdAlerts, alerts, latest: !!latest, status })}`);
  await deviceRepo.update(id.deviceId, { status: 'OFFLINE' });
  const normal = { deviceId: id.deviceId, messageId: `AQS201-OFFLINE-${short}`, ph: 7.5, recordedAt: new Date().toISOString() };
  const normalAck = await ack(pub, ackTopic, topic, normal);
  const normalRow = await telemetryRepo.findOneByOrFail({ deviceId: id.deviceId, messageId: normal.messageId });
  if (normalAck.status !== 'stored' || normalRow.isMaintenance || (await deviceRepo.findOneByOrFail({ deviceId: id.deviceId })).status !== 'ONLINE') throw new Error('OFFLINE-to-ONLINE E2E invariant failed');
  const threshold = { deviceId: id.deviceId, messageId: `AQS201-ONLINE-ALERT-${short}`, temperature: 42, recordedAt: new Date().toISOString() };
  const thresholdAck = await ack(pub, ackTopic, topic, threshold);
  const normalAlerts = await alertRepo.countBy({ deviceId: id.deviceId });
  if (thresholdAck.status !== 'stored' || createdAlerts !== 1 || normalAlerts !== 1) throw new Error(`Normal threshold E2E invariant failed: ${JSON.stringify({ thresholdAck, createdAlerts, normalAlerts })}`);
  console.log(JSON.stringify({ status: 'PASS', fixture: id, manifestPath, postgres: { toctou: 'PASS', maintenanceRows, receipts, alerts, latest }, mqtt: { acks, duplicate, offlineToOnline: normalAck, normalThreshold: thresholdAck, normalAlerts } }));
} finally {
  if (pub) pub.end(true); if (ingress) ingress.onModuleDestroy();
  if (ds.isInitialized) { await ds.query('DELETE FROM telemetry_ingest_receipts WHERE device_id=$1', [id.deviceId]); await ds.query('DELETE FROM telemetry_data WHERE device_id=$1', [id.deviceId]); await ds.query('DELETE FROM alert WHERE device_id=$1', [id.deviceId]); await ds.query('DELETE FROM threshold_config WHERE pond_id=$1', [id.pondId]); await ds.query('DELETE FROM device WHERE device_id=$1', [id.deviceId]); await ds.query('DELETE FROM pond WHERE pond_id=$1', [id.pondId]); await ds.query('DELETE FROM users WHERE user_id=$1', [id.userId]); await ds.destroy(); }
}
