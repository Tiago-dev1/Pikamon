const crypto = require('crypto');
const { createParticipantState, computeEffectiveStats, executeTurnAction, CombatError } = require('./combatEngine');

/**
 * Manages matchmaking queue, private rooms, player draft selections, and match lifecycle.
 */
class MatchManager {
  constructor(gameData) {
    this.gameData = gameData;
    this.matches = new Map(); // roomId -> match
    this.codeToRoomId = new Map(); // roomCode -> roomId
    this.socketToRoomId = new Map(); // socketId -> roomId
    this.queue = []; // [{ socketId, nickname }]
  }

  sanitizeNickname(raw) {
    const clean = typeof raw === 'string' ? raw.trim().slice(0, 18) : '';
    return clean || `Treinador-${Math.floor(100 + Math.random() * 900)}`;
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
    } while (this.codeToRoomId.has(code));
    return code;
  }

  createMatch(player1, player2 = null, options = {}) {
    const roomId = crypto.randomUUID();
    const roomCode = this.generateRoomCode();
    const isPublic = options.isPublic !== false;

    const players = [
      { id: player1.socketId, nickname: player1.nickname, team: [], creatureId: null, ready: false }
    ];
    this.socketToRoomId.set(player1.socketId, roomId);

    if (player2) {
      players.push({ id: player2.socketId, nickname: player2.nickname, team: [], creatureId: null, ready: false });
      this.socketToRoomId.set(player2.socketId, roomId);
    }

    const match = {
      roomId,
      roomCode,
      isPublic,
      createdAt: Date.now(),
      phase: player2 ? 'selecting' : 'waiting',
      players,
      battle: null,
      winnerId: null,
      endReason: null,
      rematchRequests: new Set()
    };

    this.matches.set(roomId, match);
    this.codeToRoomId.set(roomCode, roomId);
    return match;
  }

  createPrivateRoom(socketId, rawNickname, isPublic = true) {
    this.leaveQueue(socketId);
    if (this.socketToRoomId.has(socketId)) {
      throw new CombatError('ALREADY_IN_MATCH', 'Você já está em uma sala.');
    }
    const nickname = this.sanitizeNickname(rawNickname);
    return this.createMatch({ socketId, nickname }, null, { isPublic });
  }

  getOpenRooms() {
    const open = [];
    for (const match of this.matches.values()) {
      if (match.phase === 'waiting' && match.isPublic && match.players.length === 1) {
        open.push({
          roomCode: match.roomCode,
          hostNickname: match.players[0].nickname,
          createdAt: match.createdAt
        });
      }
    }
    return open.sort((a, b) => b.createdAt - a.createdAt);
  }

  joinPrivateRoom(socketId, rawCode, rawNickname) {
    this.leaveQueue(socketId);
    if (this.socketToRoomId.has(socketId)) {
      throw new CombatError('ALREADY_IN_MATCH', 'Você já está em uma sala.');
    }
    const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
    const roomId = this.codeToRoomId.get(code);
    const match = roomId ? this.matches.get(roomId) : null;

    if (!match) {
      throw new CombatError('ROOM_NOT_FOUND', `Sala "${code}" não encontrada.`);
    }
    if (match.players.length >= 2 || match.phase !== 'waiting') {
      throw new CombatError('ROOM_FULL', 'Esta sala já está cheia ou em andamento.');
    }

    const nickname = this.sanitizeNickname(rawNickname);
    match.players.push({ id: socketId, nickname, creatureId: null, ready: false });
    match.phase = 'selecting';
    this.socketToRoomId.set(socketId, roomId);
    return match;
  }

  joinQueue(socketId, rawNickname) {
    if (this.socketToRoomId.has(socketId)) {
      throw new CombatError('ALREADY_IN_MATCH', 'Você já está em uma partida.');
    }
    const nickname = this.sanitizeNickname(rawNickname);
    if (this.queue.some((entry) => entry.socketId === socketId)) {
      return { matched: false, queued: true };
    }

    if (this.queue.length > 0) {
      const opponent = this.queue.shift();
      if (opponent.socketId === socketId) {
        return { matched: false, queued: true };
      }
      const match = this.createMatch(opponent, { socketId, nickname });
      return { matched: true, match };
    }

    this.queue.push({ socketId, nickname });
    return { matched: false, queued: true };
  }

  leaveQueue(socketId) {
    const before = this.queue.length;
    this.queue = this.queue.filter((entry) => entry.socketId !== socketId);
    return this.queue.length !== before;
  }

  getMatchBySocket(socketId) {
    const roomId = this.socketToRoomId.get(socketId);
    return roomId ? this.matches.get(roomId) : null;
  }

  selectTeam(socketId, teamIds) {
    const match = this.getMatchBySocket(socketId);
    if (!match) {
      throw new CombatError('NOT_IN_MATCH', 'Você não está em nenhuma sala.');
    }
    if (match.phase !== 'selecting') {
      throw new CombatError('INVALID_PHASE', 'A seleção de criaturas já foi encerrada.');
    }
    if (!Array.isArray(teamIds) || teamIds.length !== 3) {
      throw new CombatError('INVALID_TEAM', 'Selecione exatamente 3 criaturas para sua equipe.');
    }
    for (const cid of teamIds) {
      if (!cid || !this.gameData.creaturesById[cid]) {
        throw new CombatError('CREATURE_NOT_FOUND', `Criatura "${cid}" inexistente.`);
      }
    }

    const player = match.players.find((p) => p.id === socketId);
    if (!player) {
      throw new CombatError('PLAYER_NOT_IN_MATCH', 'Jogador inválido para esta sala.');
    }

    player.team = teamIds;
    player.creatureId = teamIds[0];
    player.ready = true;

    const allReady = match.players.length === 2 && match.players.every((p) => p.ready && Array.isArray(p.team) && p.team.length === 3);
    if (allReady) {
      this.startBattle(match);
    }

    return { match, started: allReady };
  }

  selectCreature(socketId, creatureId) {
    return this.selectTeam(socketId, [creatureId, creatureId, creatureId]);
  }

  startBattle(match) {
    const p1State = createParticipantState(match.players[0], this.gameData);
    const p2State = createParticipantState(match.players[1], this.gameData);

    const p1Spd = p1State.team[0].baseStats.spd;
    const p2Spd = p2State.team[0].baseStats.spd;

    let firstPlayerId;
    if (p1Spd > p2Spd) {
      firstPlayerId = p1State.playerId;
    } else if (p2Spd > p1Spd) {
      firstPlayerId = p2State.playerId;
    } else {
      firstPlayerId = Math.random() < 0.5 ? p1State.playerId : p2State.playerId;
    }

    const firstCreatureName =
      firstPlayerId === p1State.playerId ? p1State.name : p2State.name;

    match.phase = 'battle';
    match.winnerId = null;
    match.endReason = null;
    match.rematchRequests.clear();
    match.battle = {
      turnNumber: 1,
      currentTurnPlayerId: firstPlayerId,
      participants: {
        [p1State.playerId]: p1State,
        [p2State.playerId]: p2State
      },
      log: [
        `Batalha 3v3 iniciada! ${p1State.name} vs ${p2State.name}.`,
        `${firstCreatureName} é mais veloz e lidera o combate!`
      ]
    };
  }

  handleBattleAction(socketId, payload) {
    const match = this.getMatchBySocket(socketId);
    if (!match) {
      throw new CombatError('NOT_IN_MATCH', 'Você não está em uma partida ativa.');
    }
    const turnResult = executeTurnAction(match, socketId, payload, this.gameData);
    return { match, turnResult };
  }

  requestRematch(socketId) {
    const match = this.getMatchBySocket(socketId);
    if (!match) {
      throw new CombatError('NOT_IN_MATCH', 'Você não está em uma sala.');
    }
    if (match.phase !== 'finished' || match.players.length < 2) {
      throw new CombatError('INVALID_PHASE', 'Revanche disponível apenas após o término da partida.');
    }

    match.rematchRequests.add(socketId);
    const bothReady = match.players.every((p) => match.rematchRequests.has(p.id));

    if (bothReady) {
      match.phase = 'selecting';
      match.battle = null;
      match.winnerId = null;
      match.endReason = null;
      match.rematchRequests.clear();
      for (const p of match.players) {
        p.creatureId = null;
        p.team = [];
        p.ready = false;
      }
    }

    return { match, restarted: bothReady };
  }

  removeSocket(socketId) {
    const wasQueued = this.leaveQueue(socketId);
    const match = this.getMatchBySocket(socketId);
    if (!match) {
      return { wasQueued, match: null, remainingPlayerId: null, endedByDisconnect: false };
    }

    this.socketToRoomId.delete(socketId);
    const otherPlayer = match.players.find((p) => p.id !== socketId);

    if (!otherPlayer) {
      this.destroyMatch(match);
      return { wasQueued, match: null, remainingPlayerId: null, endedByDisconnect: false };
    }

    let endedByDisconnect = false;
    if (match.phase === 'battle') {
      match.phase = 'finished';
      match.winnerId = otherPlayer.id;
      match.endReason = 'disconnect';
      const leaver = match.battle.participants[socketId];
      if (leaver) {
        match.battle.log.push(`${leaver.nickname} desconectou-se. ${otherPlayer.nickname} venceu!`);
      }
      endedByDisconnect = true;
    } else if (match.phase === 'selecting' || match.phase === 'finished') {
      // Collapse room back to waiting for remaining player or notify closure
      match.players = [otherPlayer];
      otherPlayer.creatureId = null;
      otherPlayer.ready = false;
      match.phase = 'waiting';
      match.battle = null;
      match.winnerId = null;
      match.endReason = null;
      match.rematchRequests.clear();
    }

    return {
      wasQueued,
      match,
      remainingPlayerId: otherPlayer.id,
      endedByDisconnect
    };
  }

  destroyMatch(match) {
    for (const p of match.players) {
      this.socketToRoomId.delete(p.id);
    }
    this.codeToRoomId.delete(match.roomCode);
    this.matches.delete(match.roomId);
  }

  serializeMatchState(match) {
    const participants = {};
    if (match.battle) {
      for (const [pid, p] of Object.entries(match.battle.participants)) {
        participants[pid] = {
          ...p,
          effectiveStats: computeEffectiveStats(p),
          team: p.team.map((c, idx) => ({
            creatureId: c.creatureId,
            name: c.name,
            title: c.title,
            type: c.type,
            types: Array.isArray(c.types) ? c.types : [c.type],
            hp: c.hp,
            maxHp: c.maxHp,
            fainted: c.hp <= 0,
            isActive: idx === p.activeCreatureIndex,
            effectiveStats: computeEffectiveStats(c)
          }))
        };
      }
    }

    return {
      roomId: match.roomId,
      roomCode: match.roomCode,
      phase: match.phase,
      players: match.players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        ready: p.ready,
        teamCount: Array.isArray(p.team) ? p.team.length : 0,
        team: match.phase === 'selecting' && !match.players.every((x) => x.ready) ? [] : p.team,
        creatureId: match.phase === 'selecting' && !match.players.every((x) => x.ready) ? null : p.creatureId
      })),
      battle: match.battle
        ? {
          turnNumber: match.battle.turnNumber,
          currentTurnPlayerId: match.battle.currentTurnPlayerId,
          participants,
          log: match.battle.log
        }
        : null,
      winnerId: match.winnerId,
      endReason: match.endReason,
      rematchCount: match.rematchRequests.size
    };
  }
}

module.exports = { MatchManager };

