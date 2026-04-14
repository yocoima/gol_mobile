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

const waitForSocketEventMatching = (socket, eventName, matcher, timeoutMs = 4000) =>
  new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for socket event "${eventName}" matching predicate`));
    }, timeoutMs);

    const onEvent = (payload) => {
      if (!matcher(payload)) {
        socket.once(eventName, onEvent);
        return;
      }

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

const startServer = async (extraEnv = {}) => {
  const port = await getFreePort();
  const serverProcess = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      DISCONNECT_GRACE_MS: '250',
      ...extraEnv
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

const setupReadyRoom = async (extraEnv = {}) => {
  const { baseUrl } = await startServer(extraEnv);
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

const setupStartedMatch = async (extraEnv = {}) => {
  const { host, guest, roomCode, baseUrl } = await setupReadyRoom(extraEnv);
  const hostStartedPromise = waitForSocketEvent(host, 'match:started');
  const guestStartedPromise = waitForSocketEvent(guest, 'match:started');
  guest.emit('match:start', { choice: 'cara' });
  const [hostStarted, guestStarted] = await Promise.all([hostStartedPromise, guestStartedPromise]);

  return {
    baseUrl,
    host,
    guest,
    roomCode,
    hostStarted,
    guestStarted
  };
};

const createTestPreset = (preset) => JSON.stringify(preset);

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
    const { host, guest, roomCode, hostStarted, guestStarted } = await setupStartedMatch();

    try {
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
    const { host, guest, hostStarted, guestStarted } = await setupStartedMatch();

    try {
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

  it('rejects play_card from the player who is not currently allowed to act', async () => {
    const { host, guest, hostStarted } = await setupStartedMatch();

    try {
      const currentTurn = hostStarted.matchState.currentTurn;
      const outOfTurnSocket = currentTurn === 'player' ? guest : host;
      const errorPromise = waitForSocketEvent(outOfTurnSocket, 'match:error');

      outOfTurnSocket.emit('match:play_card', { index: 0 });
      const error = await errorPromise;

      expect(error.message).toContain('Aun no es tu turno');
    } finally {
      await closeClient(host);
      await closeClient(guest);
    }
  });

  it('rejects discard requests without any selected indexes', async () => {
    const { host, guest, hostStarted } = await setupStartedMatch();

    try {
      const currentTurn = hostStarted.matchState.currentTurn;
      const actorSocket = currentTurn === 'player' ? host : guest;
      const errorPromise = waitForSocketEvent(actorSocket, 'match:error');

      actorSocket.emit('match:discard', { indexes: [] });
      const error = await errorPromise;

      expect(error.message).toBe('Selecciona al menos una carta para descartar.');
    } finally {
      await closeClient(host);
      await closeClient(guest);
    }
  });

  it('applies a valid play_card action and syncs the updated match state to both players', async () => {
    const preset = createTestPreset({
      playerHand: ['pc', 'pl', 'pa', 'pc', 'tg'],
      opponentHand: ['pc', 'pc', 'pc', 'pc', 'pc'],
      deck: ['pc', 'pc', 'pc', 'pc', 'pc', 'pc'],
      currentTurn: 'player',
      possession: 'player'
    });
    const { host, guest, hostStarted, guestStarted } = await setupStartedMatch({ TEST_MATCH_PRESET: preset });

    try {
      const currentTurn = hostStarted.matchState.currentTurn;
      const actorSocket = currentTurn === 'player' ? host : guest;
      const observerSocket = currentTurn === 'player' ? guest : host;
      const actorStart = currentTurn === 'player' ? hostStarted : guestStarted;

      const playableIndex = actorStart.matchState.yourHand.findIndex((card) =>
        ['pc', 'pl', 'pa', 'pe'].includes(card.id)
      );

      expect(playableIndex).toBeGreaterThanOrEqual(0);

      const actorUpdatePromise = waitForSocketEvent(actorSocket, 'match:updated');
      const observerUpdatePromise = waitForSocketEvent(observerSocket, 'match:updated');
      actorSocket.emit('match:play_card', { index: playableIndex });

      const [actorUpdate, observerUpdate] = await Promise.all([actorUpdatePromise, observerUpdatePromise]);

      expect(actorUpdate.matchState.playerRole).toBe(currentTurn);
      expect(observerUpdate.matchState.playerRole).toBe(currentTurn === 'player' ? 'opponent' : 'player');
      expect(actorUpdate.matchState.yourHand).toHaveLength(5);
      expect(actorUpdate.matchState.hasActedThisTurn).toBe(true);
      expect(observerUpdate.matchState.hasActedThisTurn).toBe(true);
      expect(Array.isArray(actorUpdate.matchState.recentActions)).toBe(true);
      expect(actorUpdate.matchState.recentActions.length).toBeGreaterThan(0);
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

  it('opens an offside VAR response online with deterministic test hands', async () => {
    const preset = createTestPreset({
      playerHand: ['var', 'pc', 'pc', 'pc', 'tg'],
      opponentHand: ['off', 'pc', 'pc', 'pc', 'pc'],
      deck: ['pc', 'pc', 'pc', 'pc', 'pc', 'pc'],
      currentTurn: 'opponent',
      possession: 'opponent',
      pendingShot: {
        attacker: 'player',
        defender: 'opponent',
        shotType: 'regular',
        phase: 'save',
        allowOffside: true
      }
    });
    const { host, guest } = await setupStartedMatch({ TEST_MATCH_PRESET: preset });

    try {
      const guestUpdatePromise = waitForSocketEvent(guest, 'match:updated');
      const hostUpdatePromise = waitForSocketEvent(host, 'match:updated');
      guest.emit('match:play_card', { index: 0 });

      const [guestUpdate, hostUpdate] = await Promise.all([guestUpdatePromise, hostUpdatePromise]);
      expect(guestUpdate.matchState.pendingShot.phase).toBe('offside_var');
      expect(hostUpdate.matchState.pendingShot.phase).toBe('offside_var');
      expect(guestUpdate.matchState.currentTurn).toBe('player');
      expect(hostUpdate.matchState.currentTurn).toBe('player');
    } finally {
      await closeClient(host);
      await closeClient(guest);
    }
  });

  it('lets the attacker answer offside with VAR online and returns to the save phase', async () => {
    const preset = createTestPreset({
      playerHand: ['var', 'pc', 'pc', 'pc', 'pc'],
      opponentHand: ['paq', 'pc', 'pc', 'pc', 'pc'],
      deck: ['pc', 'pc', 'pc', 'pc', 'pc', 'pc'],
      currentTurn: 'player',
      possession: 'player',
      pendingShot: {
        attacker: 'player',
        defender: 'opponent',
        shotType: 'regular',
        phase: 'offside_var',
        allowOffside: false
      }
    });
    const { host, guest } = await setupStartedMatch({ TEST_MATCH_PRESET: preset });

    try {
      const hostUpdatePromise = waitForSocketEvent(host, 'match:updated');
      const guestUpdatePromise = waitForSocketEvent(guest, 'match:updated');
      host.emit('match:play_card', { index: 0 });

      const [hostUpdate, guestUpdate] = await Promise.all([hostUpdatePromise, guestUpdatePromise]);
      expect(hostUpdate.matchState.pendingShot.phase).toBe('save');
      expect(guestUpdate.matchState.pendingShot.phase).toBe('save');
      expect(hostUpdate.matchState.currentTurn).toBe('opponent');
      expect(guestUpdate.matchState.currentTurn).toBe('opponent');
    } finally {
      await closeClient(host);
      await closeClient(guest);
    }
  });

  it('records a successful goalkeeper save online when there is no remate available', async () => {
    const preset = createTestPreset({
      playerHand: ['pc', 'pc', 'pc', 'pc', 'pc'],
      opponentHand: ['paq', 'pc', 'pc', 'pc', 'pc'],
      deck: ['pc', 'pc', 'pc', 'pc', 'pc', 'pc'],
      currentTurn: 'opponent',
      possession: 'opponent',
      pendingShot: {
        attacker: 'player',
        defender: 'opponent',
        shotType: 'regular',
        phase: 'save',
        allowOffside: false
      }
    });
    const { host, guest } = await setupStartedMatch({ TEST_MATCH_PRESET: preset });

    try {
      const guestUpdatePromise = waitForSocketEvent(guest, 'match:updated');
      const hostUpdatePromise = waitForSocketEvent(host, 'match:updated');
      guest.emit('match:play_card', { index: 0 });

      const [guestUpdate, hostUpdate] = await Promise.all([guestUpdatePromise, hostUpdatePromise]);
      expect(guestUpdate.matchState.pendingShot).toBeNull();
      expect(hostUpdate.matchState.pendingShot).toBeNull();
      expect(guestUpdate.matchState.lastEvent.type).toBe('save_success');
      expect(hostUpdate.matchState.lastEvent.type).toBe('save_success');
      expect(guestUpdate.matchState.currentTurn).toBe('opponent');
    } finally {
      await closeClient(host);
      await closeClient(guest);
    }
  });

  it('opens a red-card VAR window online after a foul response', async () => {
    const preset = createTestPreset({
      playerHand: ['tr', 'pc', 'pc', 'pc', 'pc'],
      opponentHand: ['var', 'pc', 'pc', 'pc', 'pc'],
      deck: ['pc', 'pc', 'pc', 'pc', 'pc', 'pc'],
      currentTurn: 'player',
      possession: 'player',
      pendingDefense: {
        defender: 'opponent',
        possessor: 'player',
        defenseCardId: 'fa'
      }
    });
    const { host, guest } = await setupStartedMatch({ TEST_MATCH_PRESET: preset });

    try {
      const hostUpdatePromise = waitForSocketEvent(host, 'match:updated');
      const guestUpdatePromise = waitForSocketEvent(guest, 'match:updated');
      host.emit('match:play_card', { index: 0 });

      const [hostUpdate, guestUpdate] = await Promise.all([hostUpdatePromise, guestUpdatePromise]);
      expect(hostUpdate.matchState.pendingDefense.defenseCardId).toBe('red_card_var');
      expect(guestUpdate.matchState.pendingDefense.defenseCardId).toBe('red_card_var');
      expect(hostUpdate.matchState.currentTurn).toBe('opponent');
      expect(guestUpdate.matchState.currentTurn).toBe('opponent');
    } finally {
      await closeClient(host);
      await closeClient(guest);
    }
  });

  it('lets the defender cancel a red card with VAR online', async () => {
    const preset = createTestPreset({
      playerHand: ['pc', 'pc', 'pc', 'pc', 'pc'],
      opponentHand: ['var', 'pc', 'pc', 'pc', 'pc'],
      deck: ['pc', 'pc', 'pc', 'pc', 'pc', 'pc'],
      currentTurn: 'opponent',
      possession: 'player',
      pendingDefense: {
        defender: 'opponent',
        possessor: 'player',
        defenseCardId: 'red_card_var'
      },
      activePlay: [{ id: 'pc_auto', name: 'Pase Corto', value: 1, color: 'bg-emerald-500' }]
    });
    const { host, guest } = await setupStartedMatch({ TEST_MATCH_PRESET: preset });

    try {
      const guestUpdatePromise = waitForSocketEvent(guest, 'match:updated');
      const hostUpdatePromise = waitForSocketEvent(host, 'match:updated');
      guest.emit('match:play_card', { index: 0 });

      const [guestUpdate, hostUpdate] = await Promise.all([guestUpdatePromise, hostUpdatePromise]);
      expect(guestUpdate.matchState.pendingDefense).toBeNull();
      expect(hostUpdate.matchState.pendingDefense).toBeNull();
      expect(guestUpdate.matchState.currentTurn).toBe('opponent');
      expect(hostUpdate.matchState.currentTurn).toBe('opponent');
      expect(guestUpdate.matchState.activePlay.map((card) => card.id)).toEqual(['pc_auto', 'var']);
    } finally {
      await closeClient(host);
      await closeClient(guest);
    }
  });

  it('lets the defender cancel a penalty with VAR online', async () => {
    const preset = createTestPreset({
      playerHand: ['pc', 'pc', 'pc', 'pc', 'pc'],
      opponentHand: ['var', 'pc', 'pc', 'pc', 'pc'],
      deck: ['pc', 'pc', 'pc', 'pc', 'pc', 'pc'],
      currentTurn: 'opponent',
      possession: 'player',
      pendingShot: {
        attacker: 'player',
        defender: 'opponent',
        shotType: 'penalty',
        phase: 'penalty_response'
      }
    });
    const { host, guest } = await setupStartedMatch({ TEST_MATCH_PRESET: preset });

    try {
      const guestUpdatePromise = waitForSocketEvent(guest, 'match:updated');
      const hostUpdatePromise = waitForSocketEvent(host, 'match:updated');
      guest.emit('match:play_card', { index: 0 });

      const [guestUpdate, hostUpdate] = await Promise.all([guestUpdatePromise, hostUpdatePromise]);
      expect(guestUpdate.matchState.pendingShot).toBeNull();
      expect(hostUpdate.matchState.pendingShot).toBeNull();
      expect(guestUpdate.matchState.currentTurn).toBe('opponent');
      expect(hostUpdate.matchState.currentTurn).toBe('opponent');
      expect(guestUpdate.matchState.possession).toBe('opponent');
      expect(hostUpdate.matchState.possession).toBe('opponent');
    } finally {
      await closeClient(host);
      await closeClient(guest);
    }
  });

  it('opens and resolves the blind discard flow after a red-card foul online', async () => {
    const preset = createTestPreset({
      playerHand: ['tr', 'pc', 'pc', 'pc', 'pc'],
      opponentHand: ['pc', 'pl', 'pa', 'pc', 'pc'],
      deck: ['pc', 'pc', 'pc', 'pc', 'pc', 'pc'],
      currentTurn: 'player',
      possession: 'player',
      pendingDefense: {
        defender: 'opponent',
        possessor: 'player',
        defenseCardId: 'fa'
      }
    });
    const { host, guest } = await setupStartedMatch({ TEST_MATCH_PRESET: preset });

    try {
      const hostPenaltyPromise = waitForSocketEvent(host, 'match:updated');
      const guestPenaltyPromise = waitForSocketEvent(guest, 'match:updated');
      host.emit('match:play_card', { index: 0 });

      const [hostPenaltyUpdate, guestPenaltyUpdate] = await Promise.all([hostPenaltyPromise, guestPenaltyPromise]);
      expect(hostPenaltyUpdate.matchState.pendingBlindDiscard).not.toBeNull();
      expect(guestPenaltyUpdate.matchState.pendingBlindDiscard).not.toBeNull();
      expect(hostPenaltyUpdate.matchState.redCardPenalty.opponent).toBe(3);
      expect(guestPenaltyUpdate.matchState.redCardPenalty.opponent).toBe(3);

      const hostDiscardPromise = waitForSocketEvent(host, 'match:updated');
      const guestDiscardPromise = waitForSocketEvent(guest, 'match:updated');
      host.emit('match:play_card', { index: 1 });

      const [hostDiscardUpdate, guestDiscardUpdate] = await Promise.all([hostDiscardPromise, guestDiscardPromise]);
      expect(hostDiscardUpdate.matchState.pendingBlindDiscard).toBeNull();
      expect(guestDiscardUpdate.matchState.pendingBlindDiscard).toBeNull();
      expect(hostDiscardUpdate.matchState.currentTurn).toBe('player');
      expect(Array.isArray(hostDiscardUpdate.matchState.recentActions)).toBe(true);
      expect(hostDiscardUpdate.matchState.recentActions.some((action) => action.type === 'discard')).toBe(true);
    } finally {
      await closeClient(host);
      await closeClient(guest);
    }
  });

  it('terminates an online match and resets the room back to waiting/ready state', async () => {
    const { host, guest } = await setupStartedMatch();

    try {
      const guestTerminatedPromise = waitForSocketEvent(guest, 'match:terminated');
      const hostRoomUpdatedPromise = waitForSocketEventMatching(host, 'room:updated', (payload) => payload.room.status === 'ready');
      const guestRoomUpdatedPromise = waitForSocketEventMatching(guest, 'room:updated', (payload) => payload.room.status === 'ready');
      host.emit('match:terminate');

      const [guestTerminated, hostRoomUpdated, guestRoomUpdated] = await Promise.all([
        guestTerminatedPromise,
        hostRoomUpdatedPromise,
        guestRoomUpdatedPromise
      ]);

      expect(guestTerminated.message).toContain('termino la partida');
      expect(hostRoomUpdated.room.status).toBe('ready');
      expect(guestRoomUpdated.room.status).toBe('ready');
      expect(hostRoomUpdated.room.hasMatch).toBe(false);
      expect(guestRoomUpdated.room.hasMatch).toBe(false);
    } finally {
      await closeClient(host);
      await closeClient(guest);
    }
  });

  it('removes a player from the room when they leave explicitly online', async () => {
    const { host, guest, roomCode, baseUrl } = await setupReadyRoom();

    try {
      const hostRoomUpdatedPromise = waitForSocketEvent(host, 'room:updated');
      guest.emit('room:leave');
      const hostRoomUpdated = await hostRoomUpdatedPromise;

      expect(hostRoomUpdated.room.playerCount).toBe(1);
      expect(hostRoomUpdated.room.status).toBe('waiting');
      expect(hostRoomUpdated.room.players.map((player) => player.name)).toEqual(['Host']);

      const roomsResponse = await fetch(`${baseUrl}/rooms`);
      const roomsBody = await roomsResponse.json();
      expect(roomsBody.rooms).toHaveLength(1);
      expect(roomsBody.rooms[0].code).toBe(roomCode);
      expect(roomsBody.rooms[0].playerCount).toBe(1);
    } finally {
      await closeClient(host);
      await closeClient(guest);
    }
  });
});
