/**
 * Socket.io client communication layer.
 * Sends player intents and dispatches authoritative server events.
 */
window.NetworkClient = (function () {
  class Network {
    constructor() {
      this.handlers = {};
      this.cachedEvents = {};
      this.socket = typeof io === 'function' ? io({ reconnectionAttempts: 10, timeout: 10000 }) : null;
      if (!this.socket) {
        console.error('[Network] Socket.io client script not loaded!');
      } else {
        this.bindEvents();
      }
    }

    on(event, fn) {
      if (!this.handlers[event]) this.handlers[event] = [];
      this.handlers[event].push(fn);

      // If this event was already received before listener was registered, replay it immediately
      if (this.cachedEvents[event] !== undefined) {
        try {
          fn(this.cachedEvents[event]);
        } catch (err) {
          console.error(`[Network] Error in replayed ${event} handler:`, err);
        }
      }
    }

    emitLocal(event, payload) {
      this.cachedEvents[event] = payload;
      const list = this.handlers[event] || [];
      for (const fn of list) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[Network] Error in ${event} handler:`, err);
        }
      }
    }

    bindEvents() {
      this.socket.on('connect', () => {
        this.emitLocal('connect', this.socket.id);
      });
      this.socket.on('disconnect', () => {
        delete this.cachedEvents['connect'];
        this.emitLocal('disconnect');
      });
      this.socket.on('catalog:init', (data) => this.emitLocal('catalog:init', data));
      this.socket.on('lobby:update', (data) => this.emitLocal('lobby:update', data));
      this.socket.on('queue:status', (data) => this.emitLocal('queue:status', data));
      this.socket.on('room:joined', (data) => this.emitLocal('room:joined', data));
      this.socket.on('match:state', (data) => this.emitLocal('match:state', data));
      this.socket.on('battle:turn', (data) => this.emitLocal('battle:turn', data));
      this.socket.on('match:ended', (data) => this.emitLocal('match:ended', data));
      this.socket.on('action:error', (data) => this.emitLocal('action:error', data));

      // In case socket is already connected when bindEvents runs
      if (this.socket.connected) {
        this.emitLocal('connect', this.socket.id);
      }
    }

    send(event, payload) {
      if (!this.socket) {
        this.emitLocal('action:error', {
          code: 'NO_SOCKET',
          message: 'Socket.io não foi carregado. Certifique-se de acessar pelo servidor HTTP.'
        });
        return;
      }
      this.socket.emit(event, payload);
    }

    setNickname(nickname) {
      this.send('lobby:set_nickname', { nickname });
    }

    joinQueue(nickname) {
      this.send('queue:join', { nickname });
    }

    leaveQueue() {
      this.send('queue:leave');
    }

    createRoom(nickname, isPublic = true) {
      this.send('room:create', { nickname, isPublic });
    }

    joinRoom(roomCode, nickname) {
      this.send('room:join', { roomCode, nickname });
    }

    leaveRoom() {
      this.send('room:leave');
    }

    selectTeam(team) {
      this.send('team:select', { team });
    }

    selectCreature(creatureId) {
      this.send('creature:select', { creatureId });
    }

    sendBattleAction(action) {
      this.send('battle:action', action);
    }

    requestRematch() {
      this.send('battle:rematch');
    }
  }

  return Network;
})();

