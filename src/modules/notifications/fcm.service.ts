import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getMessaging, type MulticastMessage, type SendResponse } from 'firebase-admin/messaging';

export interface FcmMulticastResult {
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
}

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private app: App | null = null;
  private isInitialized = false;
  private runtimeStatus: 'READY' | 'FCM_RUNTIME_BLOCKED' = 'FCM_RUNTIME_BLOCKED';

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.initializeFirebase();
  }

  private initializeFirebase() {
    try {
      const existingApps = getApps();
      if (existingApps.length > 0) {
        this.app = existingApps[0];
        this.isInitialized = true;
        this.runtimeStatus = 'READY';
        return;
      }

      const projectId = this.configService.get<string>('FIREBASE_PROJECT_ID');
      const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
      let privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');

      if (projectId && clientEmail && privateKey) {
        if (privateKey.includes('\\n')) {
          privateKey = privateKey.replace(/\\n/g, '\n');
        }

        this.app = initializeApp({
          credential: cert({
            projectId,
            clientEmail,
            privateKey,
          }),
        });

        this.isInitialized = true;
        this.runtimeStatus = 'READY';
        this.logger.log('Firebase Admin SDK initialized successfully.');
        return;
      }

      this.isInitialized = false;
      this.runtimeStatus = 'FCM_RUNTIME_BLOCKED';
      this.logger.warn(
        '[FcmService] Firebase credentials not configured. Operating in FCM_RUNTIME_BLOCKED mode.',
      );
    } catch (error: any) {
      this.isInitialized = false;
      this.runtimeStatus = 'FCM_RUNTIME_BLOCKED';
      this.logger.error(`[FcmService] Firebase initialization failed: ${error.message}`);
    }
  }

  isAvailable(): boolean {
    return this.isInitialized;
  }

  getStatus(): string {
    return this.runtimeStatus;
  }

  /**
   * Gửi thông báo Push đến danh sách FCM tokens (Multicast)
   * Tự động phát hiện token không hợp lệ (hết hạn / đã gỡ cài đặt ứng dụng)
   */
  async sendToTokens(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<FcmMulticastResult> {
    if (!tokens || tokens.length === 0) {
      return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    if (!this.isInitialized || !this.app) {
      this.logger.warn(
        `[FcmService] Cannot send FCM message: Firebase is in ${this.runtimeStatus} state.`,
      );
      return {
        successCount: 0,
        failureCount: tokens.length,
        invalidTokens: [],
      };
    }

    const payload: MulticastMessage = {
      tokens,
      notification: {
        title,
        body,
      },
      data: data || {},
    };

    try {
      const messaging = getMessaging(this.app);
      const response = await messaging.sendEachForMulticast(payload);

      const invalidTokens: string[] = [];
      response.responses.forEach((resp: SendResponse, index: number) => {
        if (!resp.success) {
          const errorCode = resp.error?.code;
          if (
            errorCode === 'messaging/invalid-registration-token' ||
            errorCode === 'messaging/registration-token-not-registered'
          ) {
            invalidTokens.push(tokens[index]);
          }
        }
      });

      this.logger.log(
        `[FcmService] Sent multicast: ${response.successCount} success, ${response.failureCount} failure, ${invalidTokens.length} invalid tokens`,
      );

      return {
        successCount: response.successCount,
        failureCount: response.failureCount,
        invalidTokens,
      };
    } catch (error: any) {
      this.logger.error(`[FcmService] Error sending multicast: ${error.message}`);
      throw error;
    }
  }
}
