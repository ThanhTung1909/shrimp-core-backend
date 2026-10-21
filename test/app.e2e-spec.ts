
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

type App = Parameters<typeof request>[0];

describe('P1-3 Farms & Crops (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule =
      await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /farms - Reject unauthenticated request', async () => {
    await request(app.getHttpServer())
      .get('/farms')
      .expect(401);
  });

  it('GET /crops - Reject unauthenticated request', async () => {
    await request(app.getHttpServer())
      .get('/crops')
      .expect(401);
  });

  it('POST /farms - Reject unauthenticated request', async () => {
    await request(app.getHttpServer())
      .post('/farms')
      .send({
        farmName: 'Unauthorized Test Farm',
      })
      .expect(401);
  });

  it('POST /crops - Reject unauthenticated request', async () => {
    await request(app.getHttpServer())
      .post('/crops')
      .send({
        pondId: 'e2fef228-c816-4f1c-98ac-fc69f76ece6f',
        stockingDate: '2026-10-22',
        initialQuantity: 10000,
        shrimpSpecies: 'Tôm thẻ chân trắng',
      })
      .expect(401);
  });
});
