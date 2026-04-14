import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { io as createSocketClient } from 'socket.io-client';

const serverProcesses = [];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.unref();
    tester.on('error', reject);
    tester.listen(0, '127.0.0.1', () => {
      const address = tester.address();
      tester.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve(address.port);
      });
    });
  });

const waitForSocketEvent = (socket, eventName, timeoutMs = 4000) =>
  new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for socket event "${eventName}"`));
    }, timeoutMs);

    const onEvent = (payload) => {
      cleanup();
      resolve(payload);
    };

    const onConnectError = (error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      socket.off(eventName, onEvent);
      socket.off('connect_error', onConnectError);
    };

    socket.once(eventName, onEvent);
    socket.once('connect_error', onConnectError);
  });

const waitForAnySocketEvent = (socket, eventNames, timeoutMs = 4000) =>
  new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for one of: ${eventNames.join(', ')}`));
    }, timeoutMs);

    const eventHandlers = new Map();

    const onConnectError = (error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      for (const [eventName, handler] of eventHandlers.entries()) {
        socket.off(eventName, handler);
      }
      socket.off('connect_error', onConnectError);
    };

    for (const eventName of eventNames) {
      const handler = (payload) => {
        cleanup();
        resolve({ eventName, payload });
      };
      eventHandlers.set(eventName, handler);
      socket.once(eventName, handler);
    }

    socket.once('connect_error', onConnectError);
  });

const startServer = async () => {
  const port = await getFreePort();
  const serverProcess = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DISCONNECT_GRACE_MS: '250'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcesses.push(serverProcess);

  await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out while starting backend server'));
    }, 5000);

    const onStdout = (chunk) => {
      if (chunk.toString().includes('Gol App server listening')) {
        cleanup();
        resolve();
      }
    };

    const onExit = (code) => {
      cleanup();
      reject(new Error(`Backend server exited early with code ${code}`));
    };

    const onStderr = (chunk) => {
      const message = chunk.toString();
      if (message.trim()) {
        cleanup();
        reject(new Error(message));
      }
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      serverProcess.stdout.off('data', onStdout);
      serverProcess.stderr.off('data', onStderr);
      serverProcess.off('exit', onExit);
    };

    serverProcess.stdout.on('data', onStdout);
    serverProcess.stderr.on('data', onStderr);
    serverProcess.once('exit', onExit);
  });

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`
  };
};

const createClient = async (baseUrl, clientId) => {
  const socket = createSocketClient(baseUrl, {
    transports: ['websocket'],
    auth: { clientId },
    reconnection: false
  });

  await waitForSocketEvent(socket, 'connect');
  await waitForSocketEvent(socket, 'server:ready');
  return socket;
};

const closeClient = async (socket) => {
  if (!socket) {
    return;
  }

  socket.disconnect();
  await wait(20);
};

const setupReadyRoom = async () => {
  const { baseUrl } = await startServer();
  const host = await createClient(baseUrl, 'host-client');
  const guest = await createClient(baseUrl, 'guest-client');

  const roomCreatedPromise = waitForSocketEvent(host, 'room:created');
  host.emit('room:create', { playerName: 'Host' });
  const roomCreated = await roomCreatedPromise;

  const hostRoomUpdatedPromise = waitForSocketEvent(host, 'room:updated');
  const guestRoomUpdatedPromise = waitForSocketEvent(guest, 'room:updated');
  guest.emit('room:join', { code: roomCreated.room.code, playerName: 'Guest' });
  await Promise.all([hostRoomUpdatedPromise, guestRoomUpdatedPromise]);

  return { baseUrl, host, guest, roomCode: roomCreated.room.code };
};

afterEach(async () => {
  while (serverProcesses.length > 0) {
    const serverProcess = serverProcesses.pop();
    if (!serverProcess || serverProcess.killed) {
      continue;
    }

    await new Promise((resolve) => {
      serverProcess.once('exit', resolve);
      serverProcess.kill();
    });
  }
});

describe('online server integration', () => {
  it('creates a room and lets another player join it', async () => {
    const { baseUrl } = await startServer();
    const host = await createClient(baseUrl, 'host-client');
    const guest = await createClient(baseUrl, 'guest-client');

    try {
      const roomCreatedPromise = waitForSocketEvent(host, 'room:created');
      host.emit('room:create', { playerName: 'Host' });
      const roomCreated = await roomCreatedPromise;

      expect(roomCreated.room.playerCount).toBe(1);
      expect(roomCreated.room.players[0].name).toBe('Host');

      const hostRoomUpdatedPromise = waitForSocketEvent(host, 'room:updated');
      const guestRoomUpdatedPromise = waitForSocketEvent(guest, 'room:updated');
      guest.emit('room:join', { code: roomCreated.room.code, playerName: 'Guest' });

      const [hostRoomUpdated, guestRoomUpdated] = await Promise.all([
        hostRoomUpdatedPromise,
        guestRoomUpdatedPromise
      ]);

      expect(hostRoomUpdated.room.status).toBe('ready');
      expect(guestRoomUpdated.room.playerCount).toBe(2);
      expect(guestRoomUpdated.room.players.map((player) => player.name)).toEqual(['Host', 'Guest']);
    } finally {
      await closeClient(host);
      await closeClient(guest);
    }
  });

  it('removes the previous membership when the same client creates a new room', async () => {
    const { baseUrl } = await startServer();
    const host = await createClient(baseUrl, 'sticky-client');

    try {
      const firstRoomPromise = waitForSocketEvent(host, 'room:created');
      host.emit('room:create', { playerName: 'Host' });
      const firstRoom = await firstRoomPromise;

      const secondRoomPromise = waitForSocketEvent(host, 'room:created');
      host.emit('room:create', { playerName: 'Host' });
      const secondRoom = await secondRoomPromise;

      expect(secondRoom.room.code).not.toBe(firstRoom.room.code);

      const roomsResponse = await fetch(`${baseUrl}/rooms`);
      const roomsBody = await roomsResponse.json();

      expect(roomsBody.rooms).toHaveLength(1);
      expect(roomsBody.rooms[0].code).toBe(secondRoom.room.code);
      expect(roomsBody.rooms[0].playerCount).toBe(1);
    } finally {
      await closeClient(host);
    }
  });

  it('reattaches a disconnected player to the same room before the grace timeout expires', async () => {
    const { baseUrl, host, guest, roomCode } = await setupReadyRoom();

    try {
      const disconnectedUpdatePromise = waitForSocketEvent(host, 'room:updated');
      guest.disconnect();
      const disconnectedUpdate = await disconnectedUpdatePromise;
      expect(disconnectedUpdate.room.players.find((player) => player.name === 'Guest')?.connected).toBe(false);

      const reconnectedGuest = createSocketClient(baseUrl, {
        transports: ['websocket'],
        auth: { clientId: 'guest-client' },
        reconnection: false,
        autoConnect: false
      });
      try {
        const recreatedRoomPromise = waitForSocketEvent(reconnectedGuest, 'room:created');
        const reconnectedReadyPromise = waitForSocketEvent(reconnectedGuest, 'server:ready');
        reconnectedGuest.connect();
        await waitForSocketEvent(reconnectedGuest, 'connect');
        const [recreatedRoom] = await Promise.all([recreatedRoomPromise, reconnectedReadyPromise]);
        expect(recreatedRoom.room.code).toBe(roomCode);
        expect(recreatedRoom.room.playerCount).toBe(2);
        expect(recreatedRoom.room.players.find((player) => player.name === 'Guest')?.connected).toBe(true);
      } finally {
        await closeClient(reconnectedGuest);
      }
    } finally {
      await closeClient(host);
      await closeClient(guest);
    }
  });

  it('starts an online match and notifies both players with their roles', async () => {
    const { host, guest, roomCode } = await setupReadyRoom();

    try {
      const hostStartedPromise = waitForSocketEvent(host, 'match:started');
      const guestStartedPromise = waitForSocketEvent(guest, 'match:started');
      guest.emit('match:start', { choice: 'cara' });

      const [hostStarted, guestStarted] = await Promise.all([hostStartedPromise, guestStartedPromise]);

      expect(hostStarted.room.code).toBe(roomCode);
      expect(guestStarted.room.code).toBe(roomCode);
      expect(hostStarted.matchState.playerRole).toBe('player');
      expect(guestStarted.matchState.playerRole).toBe('opponent');
      expect(hostStarted.matchState.yourHand).toHaveLength(5);
      expect(guestStarted.matchState.yourHand).toHaveLength(5);
      expect(['player', 'opponent']).toContain(hostStarted.matchState.currentTurn);
      expect(hostStarted.matchState.currentTurn).toBe(guestStarted.matchState.currentTurn);
    } finally {
      await closeClient(host);
      await closeClient(guest);
    }
  });

  it('advances the turn when the current online player ends turn', async () => {
    const { host, guest } = await setupReadyRoom();

    try {
      const hostStartedPromise = waitForSocketEvent(host, 'match:started');
      const guestStartedPromise = waitForSocketEvent(guest, 'match:started');
      guest.emit('match:start', { choice: 'cara' });

      const [hostStarted, guestStarted] = await Promise.all([hostStartedPromise, guestStartedPromise]);
      const currentTurn = hostStarted.matchState.currentTurn;
      const actorSocket = currentTurn === 'player' ? host : guest;
      const observerSocket = currentTurn === 'player' ? guest : host;

      const actorUpdatePromise = waitForSocketEvent(actorSocket, 'match:updated');
      const observerUpdatePromise = waitForSocketEvent(observerSocket, 'match:updated');
      actorSocket.emit('match:end_turn');

      const [actorUpdate, observerUpdate] = await Promise.all([actorUpdatePromise, observerUpdatePromise]);
      expect(actorUpdate.matchState.currentTurn).toBe(currentTurn === 'player' ? 'opponent' : 'player');
      expect(observerUpdate.matchState.currentTurn).toBe(actorUpdate.matchState.currentTurn);
      expect(actorUpdate.room.status).toBe('in_match');
      expect(observerUpdate.room.status).toBe('in_match');
      expect(guestStarted.matchState.playerRole).toBe('opponent');
    } finally {
      await closeClient(host);
      await closeClient(guest);
    }
  });

  it('rejects match:start when the host tries to trigger the coin flip', async () => {
    const { host, guest } = await setupReadyRoom();

    try {
      const hostErrorPromise = waitForAnySocketEvent(host, ['room:error', 'match:error']);
      host.emit('match:start', { choice: 'cara' });

      const result = await hostErrorPromise;
      expect(result.eventName).toBe('room:error');
      expect(result.payload.message).toContain('Solo el jugador invitado');
    } finally {
      await closeClient(host);
      await closeClient(guest);
    }
  });
});
