import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Server } from 'socket.io';
import { Role } from '../../common/enums/role.enum.js';
import { TelemetryGateway } from './telemetry.gateway.js';

type Middleware = (client: any, next: (error?: Error) => void) => void;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('TelemetryGateway', () => {
  let gateway: TelemetryGateway;
  let jwtService: any;
  let configService: any;
  let redisService: any;
  let pondsService: any;
  let usersService: any;
  let middleware: Middleware;
  const user = { userId: 'user-1', isActive: true, tokenVersion: 3, role: Role.FARMER };
  const client = (token?: string, id = 'socket-1') => ({
    id, handshake: { auth: token === undefined ? {} : { token } }, data: {},
    emit: vi.fn(), disconnect: vi.fn(), join: vi.fn().mockResolvedValue(undefined), leave: vi.fn().mockResolvedValue(undefined),
  });
  const runMiddleware = (socket: any) => new Promise<Error | undefined>((resolve) => middleware(socket, resolve));
  const authenticate = async (socket: any) => {
    expect(await runMiddleware(socket)).toBeUndefined();
    await gateway.handleConnection(socket);
  };

  beforeEach(() => {
    jwtService = { verifyAsync: vi.fn() };
    configService = { get: vi.fn().mockReturnValue('access-secret') };
    redisService = { getClient: vi.fn() };
    pondsService = { findPondById: vi.fn().mockResolvedValue({ pondId: 'pond-1' }) };
    usersService = { findById: vi.fn() };
    gateway = new TelemetryGateway(jwtService, configService, redisService, pondsService, usersService);
    gateway.afterInit({ use: vi.fn((handler: Middleware) => { middleware = handler; }) } as any);
  });

  const startBroadcastHarness = async () => {
    const httpServer = createServer();
    const ioServer = new Server(httpServer, { cors: { origin: '*' } });
    const namespace = ioServer.of('/telemetry');
    const { io } = await import('socket.io-client');
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(0, '127.0.0.1', resolve);
    });
    const { port } = httpServer.address() as AddressInfo;
    const connect = (name: string) => new Promise<any>((resolve, reject) => {
      const socket = io(`http://127.0.0.1:${port}/telemetry`, {
        transports: ['websocket'], reconnection: false, timeout: 2_000,
      });
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
    const [both, pondOnly, userOnly, neither] = await Promise.all([
      connect('both'), connect('pond-only'), connect('user-only'), connect('neither'),
    ]);
    await namespace.sockets.get(both.id)?.join(['pond:pond-1', 'user:user-1']);
    await namespace.sockets.get(pondOnly.id)?.join('pond:pond-1');
    await namespace.sockets.get(userOnly.id)?.join('user:user-1');
    gateway.server = namespace as any;

    return {
      namespace,
      clients: { both, pondOnly, userOnly, neither },
      close: async () => {
        [both, pondOnly, userOnly, neither].forEach((socket) => socket.disconnect());
        await new Promise<void>((resolve) => ioServer.close(() => resolve()));
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      },
    };
  };

  it('rejects missing, invalid, expired, and refresh JWTs before connection', async () => {
    expect(await runMiddleware(client())).toBeInstanceOf(Error);
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid'));
    expect(await runMiddleware(client('invalid'))).toBeInstanceOf(Error);
    expect(await runMiddleware(client('expired'))).toBeInstanceOf(Error);
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', type: 'refresh', tokenVersion: 3 });
    expect(await runMiddleware(client('refresh'))).toBeInstanceOf(Error);
    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it.each([
    ['revoked', { ...user, tokenVersion: 4 }],
    ['inactive', { ...user, isActive: false }],
    ['deleted', null],
  ])('rejects %s users before connection', async (_name, currentUser) => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', type: 'access', tokenVersion: 3 });
    usersService.findById.mockResolvedValue(currentUser);
    const socket = client('access-token');
    expect(await runMiddleware(socket)).toBeInstanceOf(Error);
    expect(socket.data.user).toBeUndefined();
  });

  it('uses database identity rather than JWT role and joins a server-managed user room', async () => {
    const socket = client('Bearer access-token');
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', role: Role.ADMIN, type: 'access', tokenVersion: 3 });
    usersService.findById.mockResolvedValue(user);
    await authenticate(socket);
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('access-token', { secret: 'access-secret' });
    expect(socket.data).toMatchObject({ user, userId: 'user-1', role: Role.FARMER });
    expect(socket.join).toHaveBeenCalledWith('user:user-1');
  });

  it('holds slow authentication at the namespace barrier, then permits immediate subscribe', async () => {
    const socket = client('access-token');
    const lookup = deferred<typeof user>();
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', type: 'access', tokenVersion: 3 });
    usersService.findById.mockReturnValue(lookup.promise);
    const authentication = runMiddleware(socket);
    await Promise.resolve();
    expect(socket.data.user).toBeUndefined();
    expect(pondsService.findPondById).not.toHaveBeenCalled();
    lookup.resolve(user);
    expect(await authentication).toBeUndefined();
    await gateway.handleConnection(socket);
    expect(await gateway.handleSubscribePond(socket as any, { pondId: 'pond-1' })).toMatchObject({ status: 'success' });
  });

  it('never releases delayed invalid authentication or its protected broadcasts', async () => {
    const socket = client('bad-token');
    const verification = deferred<any>();
    jwtService.verifyAsync.mockReturnValue(verification.promise);
    const authentication = runMiddleware(socket);
    await Promise.resolve();
    verification.reject(new Error('invalid'));
    expect(await authentication).toBeInstanceOf(Error);
    expect(socket.data.user).toBeUndefined();
    expect(pondsService.findPondById).not.toHaveBeenCalled();
  });

  it('isolates concurrent valid and invalid sockets', async () => {
    const valid = client('valid-token', 'valid');
    const invalid = client('invalid-token', 'invalid');
    jwtService.verifyAsync.mockImplementation((token: string) => token === 'valid-token'
      ? Promise.resolve({ sub: 'user-1', type: 'access', tokenVersion: 3 }) : Promise.reject(new Error('invalid')));
    usersService.findById.mockResolvedValue(user);
    const [validError, invalidError] = await Promise.all([runMiddleware(valid), runMiddleware(invalid)]);
    expect(validError).toBeUndefined();
    expect(invalidError).toBeInstanceOf(Error);
    expect(valid.data.user).toBe(user);
    expect(invalid.data.user).toBeUndefined();
  });

  it('authenticates concurrent valid sockets with independent server identities', async () => {
    const first = client('first-token', 'first');
    const second = client('second-token', 'second');
    const secondUser = { ...user, userId: 'user-2' };
    jwtService.verifyAsync.mockImplementation((token: string) => Promise.resolve({
      sub: token === 'first-token' ? 'user-1' : 'user-2', type: 'access', tokenVersion: 3,
    }));
    usersService.findById.mockImplementation((id: string) => Promise.resolve(id === 'user-1' ? user : secondUser));

    await Promise.all([authenticate(first), authenticate(second)]);

    expect(first.data.userId).toBe('user-1');
    expect(second.data.userId).toBe('user-2');
    expect(first.join).toHaveBeenCalledWith('user:user-1');
    expect(second.join).toHaveBeenCalledWith('user:user-2');
  });

  it('settles cleanly when a client disconnects during a slow lookup', async () => {
    const socket = client('access-token');
    const lookup = deferred<typeof user>();
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', type: 'access', tokenVersion: 3 });
    usersService.findById.mockReturnValue(lookup.promise);
    const authentication = runMiddleware(socket);
    socket.disconnect();
    lookup.resolve(user);
    expect(await authentication).toBeUndefined();
  });

  it('rejects arbitrary user rooms and unauthorized ponds', async () => {
    const socket = client(); socket.data.user = user;
    expect(await gateway.handleJoinRoom(socket as any, { room: 'user:other' })).toMatchObject({ status: 'error' });
    pondsService.findPondById.mockRejectedValue(new Error('forbidden'));
    expect(await gateway.handleJoinRoom(socket as any, { room: 'pond:other' })).toMatchObject({ status: 'error' });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('rejects a pond subscription without pondId', async () => {
    const socket = client(); socket.data.user = user;

    await expect(
      gateway.handleSubscribePond(socket as any, { pondId: '' }),
    ).resolves.toEqual({ status: 'error', message: 'Truyền thiếu pondId' });
    expect(pondsService.findPondById).not.toHaveBeenCalled();
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('authorizes rapid subscribe, unsubscribe, and leave events', async () => {
    const socket = client(); socket.data.user = user;
    const results = await Promise.all([
      gateway.handleSubscribePond(socket as any, { pondId: 'pond-1' }),
      gateway.handleSubscribePond(socket as any, { pondId: 'pond-1' }),
    ]);
    expect(results).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'success' })]));
    expect(await gateway.handleUnsubscribePond(socket as any, { pondId: 'pond-1' })).toMatchObject({ status: 'success' });
    expect(await gateway.handleLeaveRoom(socket as any, { room: 'pond:pond-1' })).toMatchObject({ status: 'success' });
    expect(socket.leave).toHaveBeenCalledWith('pond:pond-1');
  });

  it('allows a real Socket.IO client to subscribe immediately after connect', async () => {
    const httpServer = createServer();
    const ioServer = new Server(httpServer, { cors: { origin: '*' } });
    const namespace = ioServer.of('/telemetry');
    const { io } = await import('socket.io-client');
    let socket: any;
    jwtService.verifyAsync.mockResolvedValue({ sub: 'user-1', type: 'access', tokenVersion: 3 });
    usersService.findById.mockResolvedValue(user);
    gateway.afterInit(namespace as any);
    namespace.on('connection', (connectedSocket) => {
      void gateway.handleConnection(connectedSocket);
      connectedSocket.on('subscribe_pond', async (body, acknowledge) => {
        acknowledge(await gateway.handleSubscribePond(connectedSocket, body));
      });
    });
    try {
      await new Promise<void>((resolve, reject) => { httpServer.once('error', reject); httpServer.listen(0, '127.0.0.1', resolve); });
      const { port } = httpServer.address() as AddressInfo;
      const ack = await new Promise<any>((resolve, reject) => {
        socket = io(`http://127.0.0.1:${port}/telemetry`, { auth: { token: 'access-token' }, transports: ['websocket'], reconnection: false, timeout: 2_000 });
        socket.once('connect_error', reject);
        socket.once('connect', () => socket.timeout(2_000).emit('subscribe_pond', { pondId: 'pond-1' }, (error: Error | null, value: any) => error ? reject(error) : resolve(value)));
      });
      expect(ack).toMatchObject({ status: 'success', room: 'pond:pond-1' });
      expect(pondsService.findPondById).toHaveBeenCalledWith('pond-1', 'user-1', Role.FARMER);
    } finally {
      socket?.disconnect();
      await new Promise<void>((resolve) => ioServer.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  }, 10_000);

  it('broadcasts telemetry:new exactly once to the union of pond and user rooms', async () => {
    const harness = await startBroadcastHarness();
    const { both, pondOnly, userOnly, neither } = harness.clients;
    const received = { both: [] as any[], pondOnly: [] as any[], userOnly: [] as any[], neither: [] as any[] };
    both.on('telemetry:new', (value) => received.both.push(value));
    pondOnly.on('telemetry:new', (value) => received.pondOnly.push(value));
    userOnly.on('telemetry:new', (value) => received.userOnly.push(value));
    neither.on('telemetry:new', (value) => received.neither.push(value));
    const payload = { temperature: 28.5, deviceId: 'device-1' };
    const waitForExpected = Promise.all([
      new Promise((resolve) => both.once('telemetry:new', resolve)),
      new Promise((resolve) => pondOnly.once('telemetry:new', resolve)),
      new Promise((resolve) => userOnly.once('telemetry:new', resolve)),
    ]);

    try {
      gateway.broadcastTelemetry({ pondId: 'pond-1', userId: 'user-1', data: payload });
      await waitForExpected;
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(received.both).toEqual([payload]);
      expect(received.pondOnly).toEqual([payload]);
      expect(received.userOnly).toEqual([payload]);
      expect(received.neither).toEqual([]);
    } finally {
      await harness.close();
    }
  }, 10_000);

  it('broadcasts alert:triggered exactly once to the union of pond and user rooms', async () => {
    const harness = await startBroadcastHarness();
    const { both, pondOnly, userOnly, neither } = harness.clients;
    const received = { both: [] as any[], pondOnly: [] as any[], userOnly: [] as any[], neither: [] as any[] };
    both.on('alert:triggered', (value) => received.both.push(value));
    pondOnly.on('alert:triggered', (value) => received.pondOnly.push(value));
    userOnly.on('alert:triggered', (value) => received.userOnly.push(value));
    neither.on('alert:triggered', (value) => received.neither.push(value));
    const payload = { id: 'alert-1', type: 'THRESHOLD_EXCEEDED' };
    const waitForExpected = Promise.all([
      new Promise((resolve) => both.once('alert:triggered', resolve)),
      new Promise((resolve) => pondOnly.once('alert:triggered', resolve)),
      new Promise((resolve) => userOnly.once('alert:triggered', resolve)),
    ]);

    try {
      gateway.broadcastAlert({ pondId: 'pond-1', userId: 'user-1', alert: payload });
      await waitForExpected;
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(received.both).toEqual([payload]);
      expect(received.pondOnly).toEqual([payload]);
      expect(received.userOnly).toEqual([payload]);
      expect(received.neither).toEqual([]);
    } finally {
      await harness.close();
    }
  }, 10_000);

  it.each([
    ['telemetry:new', (payload: any) => gateway.broadcastTelemetry(payload), 'data'],
    ['alert:triggered', (payload: any) => gateway.broadcastAlert(payload), 'alert'],
  ])('targets only the requested single room for %s', async (event, broadcast, payloadKey) => {
    const harness = await startBroadcastHarness();
    const { both, pondOnly, userOnly, neither } = harness.clients;
    const received = { both: 0, pondOnly: 0, userOnly: 0, neither: 0 };
    both.on(event, () => { received.both += 1; });
    pondOnly.on(event, () => { received.pondOnly += 1; });
    userOnly.on(event, () => { received.userOnly += 1; });
    neither.on(event, () => { received.neither += 1; });
    const waitForPond = new Promise((resolve) => pondOnly.once(event, resolve));
    const value = { marker: event };

    try {
      broadcast({ pondId: 'pond-1', [payloadKey]: value });
      await waitForPond;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(received).toEqual({ both: 1, pondOnly: 1, userOnly: 0, neither: 0 });

      const waitForUser = new Promise((resolve) => userOnly.once(event, resolve));
      broadcast({ userId: 'user-1', [payloadKey]: value });
      await waitForUser;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(received).toEqual({ both: 2, pondOnly: 1, userOnly: 1, neither: 0 });
    } finally {
      await harness.close();
    }
  }, 10_000);

  it.each([
    ['telemetry:new', (payload: any) => gateway.broadcastTelemetry(payload), 'data'],
    ['alert:triggered', (payload: any) => gateway.broadcastAlert(payload), 'alert'],
  ])('does not broadcast %s without pondId or userId', async (event, broadcast, payloadKey) => {
    const harness = await startBroadcastHarness();
    const to = vi.spyOn(harness.namespace, 'to');
    try {
      broadcast({ [payloadKey]: { marker: event } });
      expect(to).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  }, 10_000);
});
