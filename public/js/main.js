/**
 * Client entry point wiring NetworkClient, BattleRenderer, and GameUI.
 */
(function () {
  const network = new window.NetworkClient();
  const canvas = document.getElementById('battle-canvas');
  const renderer = new window.BattleRenderer(canvas);

  const ui = new window.GameUI({
    onNicknameChange(nickname) {
      network.setNickname(nickname);
    },
    onJoinQueue(nickname) {
      network.joinQueue(nickname);
    },
    onCreateRoom(nickname, isPublic) {
      network.createRoom(nickname, isPublic);
    },
    onJoinRoom(roomCode, nickname) {
      network.joinRoom(roomCode, nickname);
    },
    onCancelWait() {
      network.leaveQueue();
      network.leaveRoom();
      ui.setQueueWaiting(false);
      ui.showScreen('lobby');
    },
    onSelectTeam(team) {
      network.selectTeam(team);
    },
    onSelectCreature(creatureId) {
      network.selectCreature(creatureId);
    },
    onBattleAction(action) {
      network.sendBattleAction(action);
    },
    onRequestRematch() {
      network.requestRematch();
    },
    onLeaveRoom() {
      network.leaveRoom();
      renderer.syncState(null);
      ui.updateMatchState(null);
    }
  });

  network.on('connect', (socketId) => {
    ui.setConnected(true);
    ui.setLocalPlayerId(socketId);
    renderer.setLocalPlayerId(socketId);
    if (ui.nicknameInput.value.trim()) {
      network.setNickname(ui.nicknameInput.value);
    }
  });

  network.on('disconnect', () => {
    ui.setConnected(false);
  });

  network.on('catalog:init', (catalog) => {
    ui.setCatalog(catalog);
    renderer.setCatalog(catalog);
  });

  network.on('lobby:update', (lobbyData) => {
    ui.updateLobby(lobbyData);
  });

  network.on('queue:status', ({ queued, message }) => {
    ui.setQueueWaiting(queued, message);
  });

  network.on('room:joined', ({ playerId, state }) => {
    ui.setLocalPlayerId(playerId);
    renderer.setLocalPlayerId(playerId);
    renderer.syncState(state);
    ui.updateMatchState(state);
  });

  network.on('match:state', ({ state }) => {
    renderer.syncState(state);
    ui.updateMatchState(state);
  });

  network.on('battle:turn', ({ turnResult, state }) => {
    ui.setAnimating(true);
    renderer.enqueueTurnAnimation(turnResult, state, () => {
      ui.setAnimating(false);
      ui.updateMatchState(state);
    });
  });

  network.on('match:ended', ({ state }) => {
    ui.updateMatchState(state);
  });

  network.on('action:error', ({ message }) => {
    ui.showError(message || 'Ação inválida.');
  });
})();

