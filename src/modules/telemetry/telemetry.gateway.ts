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
import { UsersService } from '../users/users.service.js';
import { Role } from '../../common/enums/role.enum.js';
import type { JwtPayload } from '../auth/strategies/jwt.strategy.js';
import type { Redis } from 'ioredis';
import { PondNotificationRecipientResolver } from '../ponds/pond-notification-recipient.resolver.js';

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
  OnModuleDestroy {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TelemetryGateway.name);
  private subscriber: Redis | null = null;
  private readonly adminSubscriptions = new Map<string, { socket: Socket; ponds: Set<string> }>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    @Inject(forwardRef(() => PondsService))
    private readonly pondsService: PondsService,
    private readonly usersService: UsersService,
    private readonly recipientResolver: PondNotificationRecipientResolver,
  ) { }

  onModuleInit() {
    this.setupRedisSubscriber();
  }

  async onModuleDestroy() {
    if (this.subscriber) {
      await this.subscriber.quit();
    }
  }

  afterInit(server: Server) {
    // Namespace middleware is awaited by Socket.IO before it emits `connect` or
    // dispatches any application event for this namespace.  Authentication in
    // handleConnection() would be too late because it performs I/O.
    server.use((client, next) => {
      void this.authenticateClient(client)
        .then(() => next())
        .catch(() => next(new Error('Xác thực WebSocket thất bại.')));
    });

    this.logger.log('🚀 [WebSocket Gateway] TelemetryGateway đã khởi tạo thành công tại namespace /telemetry');
  }

  /**
   * Xử lý khi Client kết nối WebSocket:
   * 1. Trích xuất JWT Token theo quy chuẩn thống nhất từ client.handshake.auth.token
   * 2. Giải mã và kiểm tra tính hợp lệ của Token
   * 3. Lưu thông tin User vào client.data và tự động cho User tham gia room user:<userId>
   */
  async handleConnection(client: Socket) {
    const user = client.data?.user;

    // This is a defensive invariant check. Normal connections are already
    // authenticated by the namespace middleware above.
    if (!user) {
      this.logger.warn(`[WS Auth] Client ${client.id} reached connection handler without authentication.`);
      client.disconnect();
      return;
    }

    try {
      // Keep user rooms server-managed; clients cannot select this room.
      await client.join(`user:${user.userId}`);

      this.logger.log(
        `[WS Connected] Client ${client.id} kết nối thành công (User: ${user.userId}, Role: ${user.role})`,
      );
    } catch {
      this.logger.warn(`[WS Connection Failed] Client ${client.id} không thể hoàn tất kết nối.`);
      client.disconnect();
    }
  }

  private async authenticateClient(client: Socket): Promise<void> {
    const rawToken = client.handshake.auth?.token;

    const token =
      typeof rawToken === 'string' && rawToken.startsWith('Bearer ')
        ? rawToken.slice(7).trim()
        : typeof rawToken === 'string'
          ? rawToken.trim()
          : undefined;

    if (!token) {
      this.logger.warn(`[WS Auth] Client ${client.id} bị từ chối: Thiếu auth.token.`);
      throw new Error('Missing authentication token.');
    }

    try {
      const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, { secret });

      if (payload.type !== 'access' || !payload.sub) {
        throw new Error('Loại token không phải access token.');
      }

      const user = await this.usersService.findById(payload.sub);
      if (!user || !user.isActive || user.tokenVersion !== payload.tokenVersion) {
        throw new Error('Tài khoản hoặc phiên làm việc không hợp lệ.');
      }

      client.data.user = user;
      client.data.userId = user.userId;
      client.data.role = user.role;
    } catch {
      this.logger.warn(`[WS Auth Failed] Client ${client.id} xác thực thất bại.`);
      throw new Error('WebSocket authentication failed.');
    }
  }

  handleDisconnect(client: Socket) {
    this.adminSubscriptions.delete(client.id);
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
      const current = await this.usersService.findById(user.userId);
      if (
        !current ||
        !current.isActive ||
        current.role !== user.role ||
        current.tokenVersion !== user.tokenVersion
      ) {
        this.adminSubscriptions.delete(client.id);
        await client.leave(`pond:${pondId}`);
        // Disconnect after ACK serialization so stale deactivated/logged-out sockets get the error ACK and close cleanly.
        if (typeof client.disconnect === 'function') {
          setImmediate(() => client.disconnect());
        }
        throw new Error('Tài khoản hoặc phiên làm việc không còn hợp lệ!');
      }

      // Phân quyền đầm tôm: Kiểm tra quyền truy cập ao nuôi hiện hành
      await this.pondsService.findPondById(pondId, user.userId, user.role as Role);
      await client.join(`pond:${pondId}`);
      if (user.role === Role.ADMIN && client.connected !== false) {
        const entry = this.adminSubscriptions.get(client.id) ?? { socket: client, ponds: new Set<string>() };
        entry.ponds.add(pondId);
        entry.ponds.add(pondId.trim().toLowerCase());
        this.adminSubscriptions.set(client.id, entry);
      }

      this.logger.log(
        `[WS Subscribe] Client ${client.id} (User: ${user.userId}) đã join room: pond:${pondId}`,
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

    const user = client.data?.user;
    if (!user) {
      client.disconnect();
      return { status: 'error', message: 'Chưa xác thực người dùng' };
    }

    const adminEntry = this.adminSubscriptions.get(client.id);
    if (adminEntry) {
      adminEntry.ponds.delete(pondId);
      adminEntry.ponds.delete(pondId.trim().toLowerCase());
      if (adminEntry.ponds.size === 0) this.adminSubscriptions.delete(client.id);
    }

    try {
      await this.pondsService.findPondById(pondId, user.userId, user.role as Role);
    } catch (error: any) {
      return {
        status: 'error',
        message: error.message || 'Bạn không có quyền truy cập đầm tôm này',
      };
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

    const user = client.data?.user;

    if (!user) {
      client.disconnect();
      return { status: 'error', message: 'Chưa xác thực người dùng' };
    }

    if (room.startsWith('pond:')) {
      const pondId = room.slice('pond:'.length);

      if (!pondId) {
        return { status: 'error', message: 'Thiếu pondId' };
      }

      return this.handleSubscribePond(client, { pondId });
    }

    return {
      status: 'error',
      message: 'Không được phép tự tham gia room này',
    };
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

    if (!room || !room.startsWith('pond:')) {
      return {
        status: 'error',
        message: 'Không được phép rời room này',
      };
    }

    return this.handleUnsubscribePond(client, { pondId: room.slice('pond:'.length) });
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
            void this.broadcastTelemetry(payload);
          } else if (channel === 'alert:triggered') {
            void this.broadcastAlert(payload);
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
   * Phát sự kiện telemetry:new xuống các room Socket.IO.
   * Một client thuộc nhiều room chỉ nhận một event.
   */
  async broadcastTelemetry(payload: TelemetryEventPayload) {
    await this.broadcastAuthorized(payload.pondId, 'telemetry:new', payload.data);
  }

  /**
   * Phát sự kiện alert:triggered xuống các room Socket.IO.
   * Một client thuộc nhiều room chỉ nhận một event.
   */
  async broadcastAlert(payload: AlertEventPayload) {
    await this.broadcastAuthorized(payload.pondId, 'alert:triggered', payload.alert);
  }

  private async broadcastAuthorized(pondId: string | null | undefined, event: string, data: unknown) {
    if (!this.server || !pondId) return;
    const normalizedPondId = pondId.trim().toLowerCase();

    // 1. Deliver to authorized FARMER / MANAGER recipients via private user rooms
    try {
      const resolved = await this.recipientResolver.resolve(pondId);
      const localSockets = (this.server as unknown as { sockets?: Map<string, Socket> }).sockets;
      if (localSockets instanceof Map) {
        // A user room can contain an old JWT session after tokenVersion changes.
        // Check every local socket before emitting; Redis delivers this event to
        // each gateway, so no remote socket needs to be emitted here.
        const allowedIds = new Set(resolved?.recipients.map((recipient) => recipient.userId) ?? []);
        const identities = new Map<string, Promise<Awaited<ReturnType<UsersService['findById']>>>>();
        const roomIndex = (this.server as unknown as { adapter?: { rooms?: Map<string, Set<string>> } }).adapter?.rooms;
        const candidateSockets = roomIndex instanceof Map
          ? [...new Set([...allowedIds].flatMap((id) => [...(roomIndex.get(`user:${id}`) ?? [])]))]
            .map((id) => localSockets.get(id)).filter((socket): socket is Socket => Boolean(socket))
          : [...localSockets.values()];
        await Promise.all(candidateSockets.map(async (socket) => {
          const authenticated = socket.data?.user;
          if (!authenticated?.userId || !allowedIds.has(authenticated.userId) ||
              !socket.rooms.has(`user:${authenticated.userId}`) || socket.connected === false) return;
          let lookup = identities.get(authenticated.userId);
          if (!lookup) {
            lookup = this.usersService.findById(authenticated.userId);
            identities.set(authenticated.userId, lookup);
          }
          try {
            const current = await lookup;
            if (current?.isActive && current.role === authenticated.role &&
                current.tokenVersion === authenticated.tokenVersion) socket.emit(event, data);
          } catch {
            this.logger.warn('[WS] Recipient authorization lookup failed; event not emitted.');
          }
        }));
      } else {
        this.logger.error('[WS] Local socket registry unavailable; protected event not emitted.');
      }
    } catch {
      this.logger.error('[WS] Recipient resolution failed; farmer/manager events not emitted.');
    }

    // 2. Deliver to ADMINs subscribed to this pond on their verified sockets
    try {
      const admins = [...this.adminSubscriptions.values()].filter(
        (entry) => entry.ponds.has(pondId) || entry.ponds.has(normalizedPondId),
      );
      const identities = new Map<string, Promise<Awaited<ReturnType<UsersService['findById']>>>>();
      await Promise.all(admins.map(async (entry) => {
        const authenticated = entry.socket.data?.user;
        if (!authenticated?.userId || entry.socket.connected === false) return;
        let lookup = identities.get(authenticated.userId);
        if (!lookup) {
          lookup = this.usersService.findById(authenticated.userId);
          identities.set(authenticated.userId, lookup);
        }
        try {
          const current = await lookup;
          if (current?.isActive && current.role === Role.ADMIN && current.tokenVersion === authenticated.tokenVersion &&
              this.adminSubscriptions.get(entry.socket.id) === entry &&
              (entry.ponds.has(pondId) || entry.ponds.has(normalizedPondId))) {
            entry.socket.emit(event, data);
            this.logger.log(`[WS] Emitted ${event} to ADMIN socket ${entry.socket.id} for pond ${pondId}`);
          }
        } catch {
          this.logger.warn('[WS] ADMIN authorization lookup failed; event not emitted.');
        }
      }));
    } catch {
      this.logger.error('[WS] ADMIN event delivery failed; event not emitted.');
    }
  }
}
