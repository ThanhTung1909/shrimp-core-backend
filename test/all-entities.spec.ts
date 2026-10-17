import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../src/modules/users/entities/user.entity.js';
import { Pond } from '../src/modules/ponds/entities/pond.entity.js';
import { Alert } from '../src/modules/alerts/entities/alert.entity.js';
import { AiRecommendation } from '../src/modules/alerts/entities/ai-recommendation.entity.js';
import { AiPrediction } from '../src/modules/predictions/entities/ai-prediction.entity.js';
import { ManualTestLog } from '../src/modules/ponds/entities/manual-test-log.entity.js';
import { Role } from '../src/common/enums/role.enum.js';
import { PondStatus } from '../src/common/enums/pond-status.enum.js';
import { AlertLevel } from '../src/common/enums/alert-level.enum.js';
import { AlertStatus } from '../src/common/enums/alert-status.enum.js';
import { RiskLevel } from '../src/common/enums/risk-level.enum.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Full ERD Entities Integration Test (Alert, AiRecommendation, AiPrediction, ManualTestLog)', () => {
  let moduleRef: TestingModule;
  let userRepo: Repository<User>;
  let pondRepo: Repository<Pond>;
  let alertRepo: Repository<Alert>;
  let recRepo: Repository<AiRecommendation>;
  let predRepo: Repository<AiPrediction>;
  let logRepo: Repository<ManualTestLog>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    userRepo = moduleRef.get(getRepositoryToken(User));
    pondRepo = moduleRef.get(getRepositoryToken(Pond));
    alertRepo = moduleRef.get(getRepositoryToken(Alert));
    recRepo = moduleRef.get(getRepositoryToken(AiRecommendation));
    predRepo = moduleRef.get(getRepositoryToken(AiPrediction));
    logRepo = moduleRef.get(getRepositoryToken(ManualTestLog));
  });

  afterAll(async () => {
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  it('phải tạo và liên kết thành công Alert (1:1 AiRecommendation), AiPrediction và ManualTestLog với Pond', async () => {
    // 1. Tạo User và Pond
    const user = await userRepo.save(
      userRepo.create({
        fullName: 'Kỹ Thuật Viên Minh',
        phoneNumber: `093${Date.now().toString().slice(-7)}`,
        passwordHash: 'hashed_password',
        role: Role.FARMER,
      }),
    );

    const pond = await pondRepo.save(
      pondRepo.create({
        userId: user.userId,
        pondName: 'Ao Nuôi Sú 02',
        areaM2: 3000,
        depthM: 1.8,
        shrimpDensity: 180,
        status: PondStatus.ACTIVE,
      }),
    );

    // 2. Tạo Alert và AiRecommendation (Quan hệ 1 - 1)
    const alert = await alertRepo.save(
      alertRepo.create({
        pondId: pond.pondId,
        resolvedById: user.userId,
        metricName: 'dissolvedOxygen',
        triggeredValue: 2.5,
        alertLevel: AlertLevel.CRITICAL,
        status: AlertStatus.ACTIVE,
        resolutionNote: 'Đã bật quạt nước tăng cường',
      }),
    );
    expect(alert.alertId).toBeDefined();

    const rec = await recRepo.save(
      recRepo.create({
        alertId: alert.alertId,
        actionSuggestion: 'Bật ngay tất cả quạt nước và sục khí đáy',
        chemicalDosage: 'Tạt Oxy viên 5kg/1000m3',
      }),
    );
    expect(rec.recommendationId).toBeDefined();
    expect(rec.alertId).toBe(alert.alertId);

    // 3. Tạo AiPrediction cho Pond
    const pred = await predRepo.save(
      predRepo.create({
        pondId: pond.pondId,
        predictedTime: new Date(Date.now() + 3600 * 4 * 1000), // Dự báo sau 4 tiếng
        predictedDO: 4.1,
        predictedPH: 7.6,
        riskScore: 0.75,
        riskLevel: RiskLevel.HIGH,
      }),
    );
    expect(pred.predictionId).toBeDefined();
    expect(pred.riskLevel).toBe(RiskLevel.HIGH);

    // 4. Tạo ManualTestLog do User đo cho Pond
    const log = await logRepo.save(
      logRepo.create({
        pondId: pond.pondId,
        testedById: user.userId,
        nh3Value: 0.05,
        no2Value: 0.12,
        note: 'Nước hơi đục nhẹ sau cơn mưa',
      }),
    );
    expect(log.logId).toBeDefined();

    // 5. Truy vấn đồ thị quan hệ hoàn chỉnh từ Pond
    const foundPond = await pondRepo.findOne({
      where: { pondId: pond.pondId },
      relations: {
        alerts: {
          recommendation: true,
          resolvedBy: true,
        },
        predictions: true,
        manualLogs: {
          testedBy: true,
        },
      },
    });

    expect(foundPond).toBeDefined();
    expect(foundPond?.alerts.length).toBe(1);
    expect(foundPond?.alerts[0].recommendation).toBeDefined();
    expect(foundPond?.alerts[0].recommendation.actionSuggestion).toContain('quạt nước');
    expect(foundPond?.alerts[0].resolvedBy?.fullName).toBe('Kỹ Thuật Viên Minh');
    expect(foundPond?.predictions.length).toBe(1);
    expect(foundPond?.predictions[0].riskScore).toBe(0.75);
    expect(foundPond?.manualLogs.length).toBe(1);
    expect(foundPond?.manualLogs[0].testedBy.fullName).toBe('Kỹ Thuật Viên Minh');

    // 6. Dọn dẹp test
    // Vì testedBy có ràng buộc RESTRICT (bảo vệ lịch sử kiểm định không bị xóa nhầm khi xóa user),
    // ta xóa Pond trước (Pond sẽ Cascade Delete xóa Alert, AiPrediction, ManualTestLog)
    await pondRepo.delete(pond.pondId);
    const checkPond = await pondRepo.findOne({ where: { pondId: pond.pondId } });
    expect(checkPond).toBeNull();

    await userRepo.delete(user.userId);
    const checkUser = await userRepo.findOne({ where: { userId: user.userId } });
    expect(checkUser).toBeNull();
  });
});
