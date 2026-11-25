const { CombatError } = require('./combatEngine');

/**
 * Registers Socket.io event handlers for multiplayer rooms, matchmaking, draft, and combat.
 *
 * Documented Socket.io Events:
 *
 * Client -> Server:
 * - `lobby:set_nickname` { nickname: string }
 * - `queue:join`         { nickname: string }
 * - `queue:leave`        {}
 * - `room:create`        { nickname: string, isPublic?: boolean }
 * - `room:join`          { roomCode: string, nickname: string }
 * - `room:leave`         {}
 * - `creature:select`    { creatureId: string }
 * - `battle:action`      { type: 'attack_weak'|'attack_signature'|'buff'|'debuff'|'protect'|'item'|'forfeit', itemId?: string }
 * - `battle:rematch`     {}
 *
 * Server -> Client:
 * - `catalog:init`       { types, moves, protect, creatures, items, networkInfo }
 * - `lobby:update`       { openRooms, onlineCount, onlinePlayers }
 * - `queue:status`       { queued: boolean, message: string }
 * - `room:joined`        { roomId, roomCode, playerId, state }
 * - `match:state`        { state }
 * - `battle:turn`        { turnResult, state }
 * - `match:ended`        { winnerId, reason: string, state }
 * - `action:error`       { code: string, message: string }
 */
function registerSocketHandlers(io, matchManager, gameData, networkInfo = { port: 3000, lanUrls: [] }) {
  const onlinePlayers = new Map(); // socketId -> { id, nickname, status }

  function emitError(socket, err) {
    if (err instanceof CombatError) {
      socket.emit('action:error', { code: err.code, message: err.message });
      return;
    }
    console.error('[Socket Error]', err);
    socket.emit('action:error', {
      code: 'INTERNAL_ERROR',
      message: 'Erro interno ao processar sua solicitação.'
    });
  }

  function broadcastMatchState(match) {
    const state = matchManager.serializeMatchState(match);
    io.to(match.roomId).emit('match:state', { state });
  }

  function broadcastLobbyUpdate() {
    io.emit('lobby:update', {
      openRooms: matchManager.getOpenRooms(),
      onlineCount: onlinePlayers.size,
      onlinePlayers: Array.from(onlinePlayers.values())
    });
  }

  function setPlayerMeta(socketId, rawNickname, status) {
    const current = onlinePlayers.get(socketId) || {
      id: socketId,
      nickname: `Treinador-${socketId.slice(0, 4).toUpperCase()}`,
      status: 'lobby'
    };
    if (typeof rawNickname === 'string' && rawNickname.trim()) {
      current.nickname = matchManager.sanitizeNickname(rawNickname);
    }
    if (status) {
      current.status = status;
    }
    onlinePlayers.set(socketId, current);
  }

  io.on('connection', (socket) => {
    setPlayerMeta(socket.id, '', 'lobby');

    // Send authoritative JSON catalog + LAN info on connect
    socket.emit('catalog:init', {
      ...gameData.getCatalog(),
      networkInfo
    });
    broadcastLobbyUpdate();

    socket.on('lobby:set_nickname', (payload = {}) => {
      setPlayerMeta(socket.id, payload.nickname);
      broadcastLobbyUpdate();
    });

    socket.on('queue:join', (payload = {}) => {
      try {
        setPlayerMeta(socket.id, payload.nickname, 'fila');
        const result = matchManager.joinQueue(socket.id, onlinePlayers.get(socket.id).nickname);
        if (result.matched) {
          const match = result.match;
          for (const p of match.players) {
            setPlayerMeta(p.id, p.nickname, 'em partida');
            const targetSocket = io.sockets.sockets.get(p.id);
            if (targetSocket) {
              targetSocket.join(match.roomId);
              targetSocket.emit('queue:status', { queued: false, message: 'Oponente encontrado!' });
              targetSocket.emit('room:joined', {
                roomId: match.roomId,
                roomCode: match.roomCode,
                playerId: p.id,
                state: matchManager.serializeMatchState(match)
              });
            }
          }
          broadcastMatchState(match);
        } else {
          socket.emit('queue:status', {
            queued: true,
            message: 'Procurando outro treinador na fila...'
          });
        }
        broadcastLobbyUpdate();
      } catch (err) {
        emitError(socket, err);
      }
    });

    socket.on('queue:leave', () => {
      const removed = matchManager.leaveQueue(socket.id);
      setPlayerMeta(socket.id, '', 'lobby');
      socket.emit('queue:status', {
        queued: false,
        message: removed ? 'Você saiu da fila.' : ''
      });
      broadcastLobbyUpdate();
    });

    socket.on('room:create', (payload = {}) => {
      try {
        const isPublic = payload.isPublic !== false;
        setPlayerMeta(socket.id, payload.nickname, 'aguardando');
        const match = matchManager.createPrivateRoom(
          socket.id,
          onlinePlayers.get(socket.id).nickname,
          isPublic
        );
        socket.join(match.roomId);
        socket.emit('room:joined', {
          roomId: match.roomId,
          roomCode: match.roomCode,
          playerId: socket.id,
          state: matchManager.serializeMatchState(match)
        });
        broadcastLobbyUpdate();
      } catch (err) {
        emitError(socket, err);
      }
    });

    socket.on('room:join', (payload = {}) => {
      try {
        setPlayerMeta(socket.id, payload.nickname, 'em partida');
        const match = matchManager.joinPrivateRoom(
          socket.id,
          payload.roomCode,
          onlinePlayers.get(socket.id).nickname
        );
        for (const p of match.players) {
          setPlayerMeta(p.id, p.nickname, 'em partida');
        }
        socket.join(match.roomId);
        socket.emit('room:joined', {
          roomId: match.roomId,
          roomCode: match.roomCode,
          playerId: socket.id,
          state: matchManager.serializeMatchState(match)
        });
        broadcastMatchState(match);
        broadcastLobbyUpdate();
      } catch (err) {
        setPlayerMeta(socket.id, '', 'lobby');
        emitError(socket, err);
      }
    });

    socket.on('team:select', (payload = {}) => {
      try {
        const teamIds = payload.team || payload.creatureIds || [];
        const { match } = matchManager.selectTeam(socket.id, teamIds);
        broadcastMatchState(match);
      } catch (err) {
        emitError(socket, err);
      }
    });

    socket.on('creature:select', (payload = {}) => {
      try {
        if (Array.isArray(payload.team)) {
          const { match } = matchManager.selectTeam(socket.id, payload.team);
          broadcastMatchState(match);
        } else {
          const { match } = matchManager.selectCreature(socket.id, payload.creatureId);
          broadcastMatchState(match);
        }
      } catch (err) {
        emitError(socket, err);
      }
    });

    socket.on('battle:action', (payload = {}) => {
      try {
        const { match, turnResult } = matchManager.handleBattleAction(socket.id, payload);
        const state = matchManager.serializeMatchState(match);

        io.to(match.roomId).emit('battle:turn', { turnResult, state });

        if (match.phase === 'finished') {
          io.to(match.roomId).emit('match:ended', {
            winnerId: match.winnerId,
            reason: match.endReason,
            state
          });
        }
      } catch (err) {
        emitError(socket, err);
      }
    });

    socket.on('battle:rematch', () => {
      try {
        const { match } = matchManager.requestRematch(socket.id);
        broadcastMatchState(match);
      } catch (err) {
        emitError(socket, err);
      }
    });

    function handleLeaveOrDisconnect(isDisconnect) {
      const currentMatch = matchManager.getMatchBySocket(socket.id);
      const roomId = currentMatch?.roomId;
      const result = matchManager.removeSocket(socket.id);

      if (roomId) {
        socket.leave(roomId);
      }

      if (isDisconnect) {
        onlinePlayers.delete(socket.id);
      } else {
        setPlayerMeta(socket.id, '', 'lobby');
      }

      if (result.match) {
        if (result.remainingPlayerId && !result.endedByDisconnect) {
          setPlayerMeta(result.remainingPlayerId, '', 'aguardando');
        }
        const state = matchManager.serializeMatchState(result.match);
        io.to(result.match.roomId).emit('match:state', { state });
        if (result.endedByDisconnect) {
          io.to(result.match.roomId).emit('match:ended', {
            winnerId: result.match.winnerId,
            reason: 'disconnect',
            state
          });
        }
      }

      broadcastLobbyUpdate();
    }

    socket.on('room:leave', () => {
      handleLeaveOrDisconnect(false);
    });

    socket.on('disconnect', () => {
      handleLeaveOrDisconnect(true);
    });
  });
}

module.exports = { registerSocketHandlers };
