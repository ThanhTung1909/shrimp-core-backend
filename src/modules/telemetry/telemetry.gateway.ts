import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, Injectable, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../common/redis/redis.service.js';
import { PondsService } from '../ponds/ponds.service.js';
import { Role } from '../../common/enums/role.enum.js';
import type { Redis } from 'ioredis';

export interface TelemetryEventPayload {
  pondId?: string | null;
  userId?: string | null;
  data: any;
}

export interface AlertEventPayload {
  pondId?: string | null;
  userId?: string | null;
  alert: any;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/telemetry',
})
@Injectable()
export class TelemetryGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnModuleDestroy
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TelemetryGateway.name);
  private subscriber: Redis | null = null;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    @Inject(forwardRef(() => PondsService))
    private readonly pondsService: PondsService,
  ) {}

  onModuleInit() {
    this.setupRedisSubscriber();
  }

  async onModuleDestroy() {
    if (this.subscriber) {
      await this.subscriber.quit();
    }
  }

  afterInit(server: Server) {
    this.logger.log('🚀 [WebSocket Gateway] TelemetryGateway đã khởi tạo thành công tại namespace /telemetry');
  }

  /**
   * Xử lý khi Client kết nối WebSocket:
   * 1. Trích xuất JWT Token theo quy chuẩn thống nhất từ client.handshake.auth.token
   * 2. Giải mã và kiểm tra tính hợp lệ của Token
   * 3. Lưu thông tin User vào client.data và tự động cho User tham gia room user:<userId>
   */
  async handleConnection(client: Socket) {
    const rawToken = client.handshake.auth?.token;

    const token =
      typeof rawToken === 'string' && rawToken.startsWith('Bearer ')
        ? rawToken.slice(7).trim()
        : typeof rawToken === 'string'
        ? rawToken.trim()
        : undefined;

    if (!token) {
      this.logger.warn(`[WS Auth] Client ${client.id} bị từ chối: Thiếu auth.token.`);
      client.emit('error', { message: 'Xác thực thất bại: Thiếu token trong auth payload.' });
      client.disconnect();
      return;
    }

    try {
      const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
      const payload = await this.jwtService.verifyAsync(token, { secret });

      if (payload.type !== 'access') {
        throw new Error('Loại token không phải access token.');
      }

      client.data.user = payload;
      client.data.userId = payload.sub;
      client.data.role = payload.role;

      // Tự động tham gia vào phòng cá nhân của User
      await client.join(`user:${payload.sub}`);

      this.logger.log(
        `[WS Connected] Client ${client.id} kết nối thành công (User: ${payload.sub}, Role: ${payload.role})`,
      );
    } catch (err: any) {
      this.logger.warn(
        `[WS Auth Failed] Client ${client.id} xác thực thất bại: ${err.message}`,
      );
      client.emit('error', { message: 'Token không hợp lệ hoặc đã hết hạn.' });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = client.data?.userId || 'Khách';
    this.logger.log(`[WS Disconnected] Client ${client.id} (User: ${userId}) đã ngắt kết nối.`);
  }

  /**
   * Event Listener: client đăng ký theo dõi đầm tôm theo pondId
   */
  @SubscribeMessage('subscribe_pond')
  async handleSubscribePond(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { pondId: string } | string,
  ) {
    const pondId = typeof body === 'string' ? body : body?.pondId;

    if (!pondId) {
      return { status: 'error', message: 'Truyền thiếu pondId' };
    }

    const user = client.data?.user;
    if (!user) {
      client.disconnect();
      return { status: 'error', message: 'Chưa xác thực người dùng' };
    }

    try {
      // Phân quyền đầm tôm: Kiểm tra Farmer có quyền truy cập đầm tôm này hay không
      await this.pondsService.findPondById(pondId, user.sub, user.role as Role);
      await client.join(`pond:${pondId}`);

      this.logger.log(
        `[WS Subscribe] Client ${client.id} (User: ${user.sub}) đã join room: pond:${pondId}`,
      );
      return {
        status: 'success',
        message: `Đã đăng ký theo dõi đầm tôm ${pondId} thành công`,
        room: `pond:${pondId}`,
      };
    } catch (error: any) {
      this.logger.warn(
        `[WS Forbidden] Client ${client.id} bị từ chối join room pond:${pondId}: ${error.message}`,
      );
      return {
        status: 'error',
        message: error.message || 'Bạn không có quyền truy cập đầm tôm này',
      };
    }
  }

  /**
   * Event Listener: client rời khỏi room đầm tôm
   */
  @SubscribeMessage('unsubscribe_pond')
  async handleUnsubscribePond(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { pondId: string } | string,
  ) {
    const pondId = typeof body === 'string' ? body : body?.pondId;

    if (!pondId) {
      return { status: 'error', message: 'Truyền thiếu pondId' };
    }

    await client.leave(`pond:${pondId}`);
    this.logger.log(`[WS Unsubscribe] Client ${client.id} đã rời room: pond:${pondId}`);

    return {
      status: 'success',
      message: `Đã hủy đăng ký theo dõi đầm tôm ${pondId}`,
    };
  }

  /**
   * Event Listener linh hoạt: join room tùy chọn
   */
  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { room: string } | string,
  ) {
    const room = typeof body === 'string' ? body : body?.room;

    if (!room) {
      return { status: 'error', message: 'Thiếu thông tin room' };
    }

    if (room.startsWith('pond:')) {
      const pondId = room.split(':')[1];
      return this.handleSubscribePond(client, { pondId });
    }

    await client.join(room);
    return { status: 'success', room };
  }

  /**
   * Event Listener linh hoạt: leave room tùy chọn
   */
  @SubscribeMessage('leave_room')
  async handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { room: string } | string,
  ) {
    const room = typeof body === 'string' ? body : body?.room;

    if (room) {
      await client.leave(room);
    }
    return { status: 'success' };
  }

  /**
   * Thiết lập Redis Subscriber để lắng nghe tin nhắn Pub/Sub đa instance
   */
  private setupRedisSubscriber() {
    try {
      const mainClient = this.redisService.getClient();
      if (!mainClient) {
        this.logger.warn('[Redis Subscriber] Chưa có kết nối Redis main client.');
        return;
      }

      this.subscriber = mainClient.duplicate();

      this.subscriber.subscribe('telemetry:new', 'alert:triggered', (err, count) => {
        if (err) {
          this.logger.error(`[Redis Subscriber Error] Không thể subscribe channels: ${err.message}`);
        } else {
          this.logger.log(`[Redis Subscriber] Đã kết nối kênh Pub/Sub thành công (${count} channels).`);
        }
      });

      this.subscriber.on('message', (channel, message) => {
        try {
          const payload = JSON.parse(message);
          if (channel === 'telemetry:new') {
            this.broadcastTelemetry(payload);
          } else if (channel === 'alert:triggered') {
            this.broadcastAlert(payload);
          }
        } catch (e: any) {
          this.logger.error(`[Redis Message Error] Lỗi xử lý tin nhắn kênh ${channel}: ${e.message}`);
        }
      });
    } catch (err: any) {
      this.logger.error(`[Redis Subscriber Exception] Lỗi khởi tạo: ${err.message}`);
    }
  }

  /**
   * Phát sự kiện telemetry:new xuống các room Socket.io
   */
  broadcastTelemetry(payload: TelemetryEventPayload) {
    const { pondId, userId, data } = payload;
    if (pondId && this.server) {
      this.server.to(`pond:${pondId}`).emit('telemetry:new', data);
    }
    if (userId && this.server) {
      this.server.to(`user:${userId}`).emit('telemetry:new', data);
    }
  }

  /**
   * Phát sự kiện alert:triggered xuống các room Socket.io
   */
  broadcastAlert(payload: AlertEventPayload) {
    const { pondId, userId, alert } = payload;
    if (pondId && this.server) {
      this.server.to(`pond:${pondId}`).emit('alert:triggered', alert);
    }
    if (userId && this.server) {
      this.server.to(`user:${userId}`).emit('alert:triggered', alert);
    }
  }
}
