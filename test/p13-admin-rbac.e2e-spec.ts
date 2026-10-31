import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { configureHttpApp } from '../src/http-app.config.js';
import { Role } from '../src/common/enums/role.enum.js';
import { User } from '../src/modules/users/entities/user.entity.js';
import { Farm } from '../src/modules/farms/entities/farm.entity.js';
import { Pond } from '../src/modules/ponds/entities/pond.entity.js';
import { ShrimpBatch } from '../src/modules/crops/entities/shrimp-batch.entity.js';
import { ManualTestLog } from '../src/modules/ponds/entities/manual-test-log.entity.js';
import { PondFarmerAssignment } from '../src/modules/ponds/entities/pond-farmer-assignment.entity.js';
import { ShrimpBatchStatus } from '../src/common/enums/shrimp-batch-status.enum.js';

const cases: Array<{ id: string; role: string; api: string; expected: number; actual: number }> = [];

describe('P1-3 isolated ADMIN RBAC HTTP verification', () => {
  let app: any;
  let ds: DataSource;
  let jwt: JwtService;
  let admin: User;
  let managerA: User;
  let managerB: User;
  let farmerA: User;
  let farmerB: User;
  let farmA: Farm;
  let farmB: Farm;
  let pondA: Pond;
  let pondB: Pond;
  let cropB: ShrimpBatch;
  let manualB: ManualTestLog;

  const token = (user: User) => jwt.sign({
    sub: user.userId, phoneNumber: user.phoneNumber, tokenVersion: user.tokenVersion,
    role: user.role, type: 'access', jti: randomUUID(),
  });
  const call = async (id: string, role: string, expected: number, method: string, path: string, auth: User, body?: unknown) => {
    const response = await request(app.getHttpServer())[method.toLowerCase()](path)
      .set('Authorization', `Bearer ${token(auth)}`)
      .send(body);
    cases.push({ id, role, api: `${method} ${path}`, expected, actual: response.status });
    expect(response.status).toBe(expected);
    return response;
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureHttpApp(app);
    await app.init();
    ds = app.get(DataSource);
    jwt = app.get(JwtService);

    const users = ds.getRepository(User);
    const makeUser = async (role: Role, suffix: string) => users.save(users.create({
      fullName: `P13 E2E ${suffix}`, phoneNumber: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
      email: `p13-${suffix}-${randomUUID()}@example.test`, passwordHash: 'e2e-not-used', role,
      isActive: true, isLocked: false, mustChangePassword: false, tokenVersion: 0,
    }));
    admin = await makeUser(Role.ADMIN, 'admin');
    managerA = await makeUser(Role.MANAGER, 'manager-a');
    managerB = await makeUser(Role.MANAGER, 'manager-b');
    farmerA = await makeUser(Role.FARMER, 'farmer-a');
    farmerB = await makeUser(Role.FARMER, 'farmer-b');

    const farms = ds.getRepository(Farm);
    farmA = await farms.save(farms.create({ farmName: `P13 Farm A ${randomUUID()}`, ownerId: managerA.userId }));
    farmB = await farms.save(farms.create({ farmName: `P13 Farm B ${randomUUID()}`, ownerId: managerB.userId }));
    const ponds = ds.getRepository(Pond);
    pondA = await ponds.save(ponds.create({ userId: managerA.userId, farmId: farmA.farmId, pondName: `P13 Pond A ${randomUUID()}`, areaM2: 100, depthM: 1, shrimpDensity: 20 }));
    pondB = await ponds.save(ponds.create({ userId: managerB.userId, farmId: farmB.farmId, pondName: `P13 Pond B ${randomUUID()}`, areaM2: 100, depthM: 1, shrimpDensity: 20 }));
    await ds.getRepository(PondFarmerAssignment).save({ pondId: pondA.pondId, farmerId: farmerA.userId });
    await ds.getRepository(PondFarmerAssignment).save({ pondId: pondB.pondId, farmerId: farmerB.userId });
    cropB = await ds.getRepository(ShrimpBatch).save({ pondId: pondB.pondId, stockingDate: '2026-01-01', initialQuantity: '1000', shrimpSpecies: 'Vannamei', status: ShrimpBatchStatus.ACTIVE });
    manualB = await ds.getRepository(ManualTestLog).save({ pondId: pondB.pondId, testedById: farmerB.userId, nh3Value: 0.1, no2Value: 0.1, note: 'fixture', testedAt: new Date() });
  });

  afterAll(async () => { await app?.close(); });

  it('enforces the approved ADMIN/MANAGER/FARMER policy over HTTP', async () => {
    await call('P13-01', 'ADMIN', 200, 'GET', `/farms/${farmA.farmId}`, admin);
    await call('P13-02', 'ADMIN', 200, 'PATCH', `/farms/${farmA.farmId}`, admin, { address: 'Admin audited' });
    const adminFarm = await call('P13-03', 'ADMIN', 201, 'POST', '/farms', admin, { farmName: `P13 Admin ${randomUUID()}` });
    await call('P13-04', 'ADMIN', 200, 'DELETE', `/farms/${adminFarm.body.data.farmId}`, admin);
    await call('P13-05', 'ADMIN', 200, 'PATCH', `/ponds/${pondB.pondId}`, admin, { location: 'Admin updated' });
    const adminCrop = await call('P13-06', 'ADMIN', 201, 'POST', '/crops', admin, { pondId: pondA.pondId, stockingDate: '2026-02-01', initialQuantity: 500, shrimpSpecies: 'Vannamei' });
    await call('P13-07', 'ADMIN', 200, 'PATCH', `/crops/${adminCrop.body.data.batchId}`, admin, { shrimpSpecies: 'Admin updated' });
    await call('P13-08', 'ADMIN', 200, 'DELETE', `/crops/${adminCrop.body.data.batchId}`, admin);

    await call('P13-09', 'ADMIN', 201, 'POST', `/ponds/${pondA.pondId}/farmers`, admin, { farmerId: farmerB.userId });
    await call('P13-10', 'ADMIN', 200, 'DELETE', `/ponds/${pondA.pondId}/farmers/${farmerB.userId}`, admin);

    await call('P13-11', 'MANAGER-A', 403, 'GET', `/ponds/manual-logs/${manualB.logId}`, managerA);
    await call('P13-12', 'MANAGER-A', 403, 'PATCH', `/ponds/manual-logs/${manualB.logId}`, managerA, { note: 'tamper' });
    await call('P13-13', 'MANAGER-A', 403, 'DELETE', `/ponds/manual-logs/${manualB.logId}`, managerA);
    await call('P13-14', 'MANAGER-B', 200, 'PATCH', `/ponds/manual-logs/${manualB.logId}`, managerB, { note: 'owner update' });

    const farmerLog = await call('P13-15', 'FARMER-B', 201, 'POST', `/ponds/${pondB.pondId}/manual-logs`, farmerB, { nh3Value: 0.2, no2Value: 0.2, note: 'farmer entry' });
    const farmerLogId = farmerLog.body.data.data.logId;
    await call('P13-16', 'FARMER-B', 200, 'GET', `/ponds/manual-logs/${farmerLogId}`, farmerB);
    await call('P13-17', 'FARMER-B', 403, 'PATCH', `/ponds/manual-logs/${farmerLogId}`, farmerB, { note: 'forbidden' });
    await call('P13-18', 'FARMER-B', 403, 'DELETE', `/ponds/manual-logs/${farmerLogId}`, farmerB);

    const pondResponse = await call('P13-19', 'ADMIN', 200, 'GET', `/ponds/${pondB.pondId}`, admin);
    expect(JSON.stringify(pondResponse.body)).not.toContain(managerB.email!);
    expect(JSON.stringify(pondResponse.body)).not.toContain(managerB.phoneNumber);
    const logResponse = await call('P13-20', 'ADMIN', 200, 'GET', `/ponds/manual-logs/${manualB.logId}`, admin);
    expect(JSON.stringify(logResponse.body)).not.toContain(farmerB.email!);
    expect(JSON.stringify(logResponse.body)).not.toContain(farmerB.phoneNumber);

    await call('P13-21', 'ADMIN', 200, 'DELETE', `/ponds/${pondB.pondId}/farmers/${farmerB.userId}`, admin);
    await call('P13-22', 'FARMER-B revoked', 403, 'GET', `/ponds/${pondB.pondId}`, farmerB);
    await call('P13-23', 'FARMER-B revoked', 403, 'GET', `/crops/${cropB.batchId}`, farmerB);
    await call('P13-24', 'FARMER-B revoked', 403, 'GET', `/crops/${cropB.batchId}/harvests`, farmerB);
    await call('P13-25', 'FARMER-B revoked', 403, 'GET', `/ponds/manual-logs/${manualB.logId}`, farmerB);
  });

  afterAll(() => { console.table(cases); });
});
