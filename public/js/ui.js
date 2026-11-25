/**
 * DOM UI controller for lobby, creature draft, 4-button battle menu, submenus, and logs.
 */
window.GameUI = (function () {
  class UI {
    constructor(callbacks) {
      this.cb = callbacks;
      this.catalog = null;
      this.localPlayerId = null;
      this.matchState = null;
      this.activeSubmenu = null;
      this.animating = false;
      this.toastTimer = null;

      this.cacheElements();
      this.bindDomEvents();
      this.applyInviteFromUrl();
    }

    cacheElements() {
      this.connStatus = document.getElementById('connection-status');
      this.onlineCountPill = document.getElementById('online-count-pill');
      this.toast = document.getElementById('error-toast');

      this.screens = {
        lobby: document.getElementById('screen-lobby'),
        select: document.getElementById('screen-select'),
        battle: document.getElementById('screen-battle')
      };

      // Lobby
      this.nicknameInput = document.getElementById('nickname-input');
      this.lobbyShowcase = document.getElementById('lobby-showcase');
      this.inviteBanner = document.getElementById('invite-banner');
      this.publicRoomCheckbox = document.getElementById('public-room-checkbox');
      this.roomCodeInput = document.getElementById('room-code-input');
      this.btnQueue = document.getElementById('btn-queue');
      this.btnCreateRoom = document.getElementById('btn-create-room');
      this.btnJoinRoom = document.getElementById('btn-join-room');
      this.waitingBox = document.getElementById('lobby-waiting-box');
      this.waitingText = document.getElementById('lobby-waiting-text');
      this.roomCodeDisplay = document.getElementById('room-code-display');
      this.inviteLinkBox = document.getElementById('invite-link-box');
      this.inviteLinkInput = document.getElementById('invite-link-input');
      this.btnCopyInvite = document.getElementById('btn-copy-invite');
      this.lanTipText = document.getElementById('lan-tip-text');
      this.btnCancelWait = document.getElementById('btn-cancel-wait');
      this.openRoomsList = document.getElementById('open-rooms-list');
      this.onlinePlayersList = document.getElementById('online-players-list');
      this.onlineListCount = document.getElementById('online-list-count');

      // Select
      this.selectRoomCode = document.getElementById('select-room-code');
      this.opponentDraftStatus = document.getElementById('opponent-draft-status');
      this.creatureGrid = document.getElementById('creature-grid');
      this.btnConfirmTeam = document.getElementById('btn-confirm-team');
      this.teamCounter = document.getElementById('team-counter');
      this.selectedTeam = [];

      // Battle
      this.turnBadge = document.getElementById('turn-badge');
      this.turnOwnerText = document.getElementById('turn-owner-text');
      this.btnForfeit = document.getElementById('btn-forfeit');
      this.btnProtect = document.getElementById('menu-btn-protect');
      this.protectSubtext = document.getElementById('protect-subtext');
      this.btnSwitch = document.getElementById('menu-btn-switch');
      this.switchSubtext = document.getElementById('switch-subtext');
      this.submenuPanel = document.getElementById('submenu-panel');
      this.submenuTitle = document.getElementById('submenu-title');
      this.submenuList = document.getElementById('submenu-list');
      this.btnCloseSubmenu = document.getElementById('btn-close-submenu');
      this.combatStatsSummary = document.getElementById('combat-stats-summary');
      this.battleLog = document.getElementById('battle-log');

      // Type chart modal
      this.typeChartModal = document.getElementById('type-chart-modal');
      this.btnCloseTypeChart = document.getElementById('btn-close-type-chart');

      // Match over overlay
      this.matchOverlay = document.getElementById('match-over-overlay');
      this.matchResultTitle = document.getElementById('match-result-title');
      this.matchResultSubtitle = document.getElementById('match-result-subtitle');
      this.btnRematch = document.getElementById('btn-rematch');
      this.btnBackLobby = document.getElementById('btn-back-lobby');

      this.mainButtons = document.querySelectorAll('.main-action-grid .action-btn');
    }

    bindDomEvents() {
      let nickTimer = null;
      this.nicknameInput.addEventListener('input', () => {
        clearTimeout(nickTimer);
        nickTimer = setTimeout(() => {
          this.cb.onNicknameChange(this.nicknameInput.value);
        }, 300);
      });

      this.btnQueue.addEventListener('click', () => {
        this.cb.onJoinQueue(this.nicknameInput.value);
      });

      this.btnCreateRoom.addEventListener('click', () => {
        this.cb.onCreateRoom(this.nicknameInput.value, this.publicRoomCheckbox.checked);
      });

      this.btnJoinRoom.addEventListener('click', () => {
        this.cb.onJoinRoom(this.roomCodeInput.value, this.nicknameInput.value);
      });

      this.btnCopyInvite.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(this.inviteLinkInput.value);
          this.btnCopyInvite.textContent = '✓ Copiado!';
          setTimeout(() => {
            this.btnCopyInvite.textContent = 'Copiar Link';
          }, 1800);
        } catch {
          this.inviteLinkInput.select();
          document.execCommand('copy');
          this.btnCopyInvite.textContent = '✓ Copiado!';
          setTimeout(() => {
            this.btnCopyInvite.textContent = 'Copiar Link';
          }, 1800);
        }
      });

      this.btnCancelWait.addEventListener('click', () => {
        this.cb.onCancelWait();
      });

      this.btnConfirmTeam.addEventListener('click', () => {
        if (this.selectedTeam.length === 3) {
          this.btnConfirmTeam.disabled = true;
          this.btnConfirmTeam.textContent = 'Enviando equipe...';
          this.cb.onSelectTeam(this.selectedTeam);
        }
      });

      this.btnForfeit.addEventListener('click', () => {
        this.cb.onBattleAction({ type: 'forfeit' });
      });

      this.btnCloseSubmenu.addEventListener('click', () => {
        this.activeSubmenu = null;
        this.renderBattleControls();
      });

      this.btnRematch.addEventListener('click', () => {
        this.btnRematch.disabled = true;
        this.btnRematch.textContent = 'Aguardando oponente...';
        this.cb.onRequestRematch();
      });

      this.btnBackLobby.addEventListener('click', () => {
        this.cb.onLeaveRoom();
      });

      // Type chart modal - open buttons (lobby, select, battle)
      document.querySelectorAll('.btn-type-chart').forEach(btn => {
        btn.addEventListener('click', () => this.showTypeChart());
      });

      // Type chart modal - close
      const modalEl = document.getElementById('type-chart-modal');
      if (modalEl) {
        modalEl.addEventListener('click', (e) => {
          if (e.target === modalEl) this.closeTypeChart();
        });
        const closeBtn = document.getElementById('btn-close-type-chart');
        if (closeBtn) closeBtn.addEventListener('click', () => this.closeTypeChart());
      }

      for (const btn of this.mainButtons) {
        btn.addEventListener('click', () => {
          const menu = btn.dataset.menu;
          if (menu === 'protect') {
            this.activeSubmenu = null;
            this.cb.onBattleAction({ type: 'protect' });
            this.renderBattleControls();
            return;
          }
          this.activeSubmenu = this.activeSubmenu === menu ? null : menu;
          this.renderBattleControls();
        });
      }
    }

    showTypeChart() {
      const modal = document.getElementById('type-chart-modal');
      if (!modal || !this.catalog) return;
      this.renderTypeChartTable();
      modal.classList.remove('hidden');
    }

    closeTypeChart() {
      const modal = document.getElementById('type-chart-modal');
      if (modal) modal.classList.add('hidden');
    }

    renderTypeChartTable() {
      const container = document.getElementById('type-chart-table-wrap');
      if (!container || !this.catalog) return;
      const types = Object.values(this.catalog.types);
      const typeIds = types.map(t => t.id);

      // Build header
      let html = '<table class="type-chart-table"><thead><tr><th class="tc-corner">ATK ↓ vs DEF →</th>';
      for (const def of types) {
        html += `<th class="tc-def-head" style="background:${def.color}20;color:${def.color}" title="${def.name}">${def.name.slice(0,3).toUpperCase()}</th>`;
      }
      html += '</tr></thead><tbody>';

      for (const atk of types) {
        html += `<tr><td class="tc-atk-label" style="background:${atk.color}20;color:${atk.color}">${atk.name}</td>`;
        for (const def of types) {
          const eff = (atk.effectiveness && atk.effectiveness[def.id]) ?? 1.0;
          let cls = 'tc-neutral'; let symbol = '1×';
          if (eff >= 2.0) { cls = 'tc-ultra'; symbol = '2×'; }
          else if (eff >= 1.4) { cls = 'tc-super'; symbol = '1.5×'; }
          else if (eff <= 0.1) { cls = 'tc-immune'; symbol = '0'; }
          else if (eff <= 0.6) { cls = 'tc-weak2'; symbol = '½×'; }
          else if (eff < 0.9) { cls = 'tc-weak'; symbol = '0.67×'; }
          html += `<td class="${cls}" title="${atk.name} vs ${def.name}: ×${eff}">${symbol}</td>`;
        }
        html += '</tr>';
      }
      html += '</tbody></table>';

      container.innerHTML = html;
    }

    setConnected(isConnected) {
      this.connStatus.textContent = isConnected ? 'Conectado' : 'Desconectado';
      this.connStatus.className = `conn-pill ${isConnected ? 'online' : 'offline'}`;
    }

    showError(message) {
      this.toast.textContent = message;
      this.toast.classList.remove('hidden');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        this.toast.classList.add('hidden');
      }, 3400);
    }

    showScreen(name) {
      for (const [key, el] of Object.entries(this.screens)) {
        el.classList.toggle('active', key === name);
      }
    }

    setCatalog(catalog) {
      this.catalog = catalog;
      this.renderLobbyShowcase();
      this.renderCreatureGrid();
    }

    renderLobbyShowcase() {
      if (!this.catalog || !this.lobbyShowcase) return;
      this.lobbyShowcase.innerHTML = '';
      for (const creature of this.catalog.creatures) {
        const c = document.createElement('canvas');
        c.className = 'showcase-canvas';
        c.width = 48;
        c.height = 48;
        c.title = `${creature.name} (${this.catalog.types[creature.type]?.name || creature.type})`;
        window.PikamonSprites.renderCreaturePreview(c, creature);
        this.lobbyShowcase.appendChild(c);
      }
    }

    applyInviteFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const room = params.get('room');
      if (room) {
        const clean = room.trim().toUpperCase().slice(0, 4);
        if (clean) {
          this.roomCodeInput.value = clean;
          this.inviteBanner.textContent = `Convite recebido para a sala ${clean}! Digite seu nome e clique em Entrar.`;
          this.inviteBanner.classList.remove('hidden');
        }
      }
    }

    updateLobby({ openRooms = [], onlineCount = 0, onlinePlayers = [] }) {
      this.onlineCountPill.textContent = `${onlineCount} online`;
      this.onlineListCount.textContent = `${onlineCount}`;
      this.openRoomsList.innerHTML = '';

      if (openRooms.length === 0) {
        this.openRoomsList.innerHTML =
          '<div class="empty-rooms">Nenhuma sala aberta no momento. Crie uma ou entre na fila!</div>';
      } else {
        for (const room of openRooms) {
          const row = document.createElement('div');
          row.className = 'open-room-item';
          row.innerHTML = `
            <div class="open-room-meta">
              <strong>${room.hostNickname}</strong>
              <span>SALA ${room.roomCode}</span>
            </div>
            <button class="btn btn-accent btn-xs">Entrar</button>
          `;
          row.querySelector('button').addEventListener('click', () => {
            this.cb.onJoinRoom(room.roomCode, this.nicknameInput.value);
          });
          this.openRoomsList.appendChild(row);
        }
      }

      this.onlinePlayersList.innerHTML = '';
      if (onlinePlayers.length === 0) {
        const li = document.createElement('li');
        li.className = 'empty-rooms';
        li.textContent = 'Nenhum treinador conectado.';
        this.onlinePlayersList.appendChild(li);
      } else {
        for (const p of onlinePlayers) {
          const isMe = p.id === this.localPlayerId;
          const li = document.createElement('li');
          li.className = 'online-player-item';
          li.innerHTML = `
            <span class="online-player-name">
              <span class="online-dot"></span>
              <span>${p.nickname}${isMe ? ' (você)' : ''}</span>
            </span>
            <span class="online-player-status">${p.status}</span>
          `;
          this.onlinePlayersList.appendChild(li);
        }
      }
    }

    setQueueWaiting(queued, message) {
      if (queued) {
        this.waitingBox.classList.remove('hidden');
        this.waitingText.textContent = message || 'Procurando oponente...';
        this.roomCodeDisplay.classList.add('hidden');
        this.inviteLinkBox.classList.add('hidden');
        this.lanTipText.classList.add('hidden');
      } else {
        this.waitingBox.classList.add('hidden');
      }
    }

    showPrivateRoomWaiting(roomCode) {
      this.showScreen('lobby');
      this.waitingBox.classList.remove('hidden');
      this.waitingText.textContent = 'Sala criada! Compartilhe o código ou link com seu amigo:';
      this.roomCodeDisplay.textContent = roomCode;
      this.roomCodeDisplay.classList.remove('hidden');

      const lanUrls = this.catalog?.networkInfo?.lanUrls || [];
      const isLocalhost =
        window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const baseOrigin = isLocalhost && lanUrls.length > 0 ? lanUrls[0] : window.location.origin;
      const inviteUrl = `${baseOrigin}/?room=${roomCode}`;

      this.inviteLinkInput.value = inviteUrl;
      this.inviteLinkBox.classList.remove('hidden');

      if (isLocalhost && lanUrls.length > 0) {
        this.lanTipText.textContent = `Mesmo Wi-Fi (LAN): seu amigo pode abrir ${inviteUrl}`;
        this.lanTipText.classList.remove('hidden');
      } else {
        this.lanTipText.classList.add('hidden');
      }
    }

    setLocalPlayerId(playerId) {
      this.localPlayerId = playerId;
    }

    setAnimating(flag) {
      this.animating = flag;
      this.renderBattleControls();
    }

    updateTeamSelectionUI() {
      const count = this.selectedTeam.length;
      if (this.teamCounter) {
        this.teamCounter.textContent = `${count}/3`;
      }
      if (this.btnConfirmTeam) {
        this.btnConfirmTeam.disabled = count !== 3;
        this.btnConfirmTeam.textContent = count === 3 ? 'Confirmar Equipe (3/3)' : `Confirmar Equipe (${count}/3)`;
      }

      const cards = this.creatureGrid.querySelectorAll('.creature-card');
      for (const card of cards) {
        const cid = card.dataset.creatureId;
        const idx = this.selectedTeam.indexOf(cid);
        const existingBadge = card.querySelector('.slot-badge');
        if (existingBadge) existingBadge.remove();

        if (idx >= 0) {
          card.classList.add('selected');
          const badge = document.createElement('div');
          badge.className = 'slot-badge';
          badge.textContent = idx === 0 ? '1º Líder' : `${idx + 1}º Reserva`;
          card.appendChild(badge);
        } else {
          card.classList.remove('selected');
        }
      }
    }

    renderCreatureGrid() {
      if (!this.catalog) return;
      this.creatureGrid.innerHTML = '';

      for (const creature of this.catalog.creatures) {
        const typeDef = this.catalog.types[creature.type];
        const sigMove = this.catalog.moves[creature.signatureMoveId];
        const weakMove = this.catalog.moves[creature.weakMoveId];
        const types = Array.isArray(creature.types) ? creature.types : [creature.type];

        // Build type pills (1 or 2)
        const typePillsHtml = types.map(tid => {
          const td = this.catalog.types[tid];
          return `<span class="type-pill" style="background:${td?.color || '#555'}">${(td?.name || tid).toUpperCase()}</span>`;
        }).join(' ');

        const card = document.createElement('div');
        card.className = 'creature-card';
        card.dataset.creatureId = creature.id;

        card.innerHTML = `
          <div class="creature-card-top">
            <canvas class="preview-canvas" width="72" height="72"></canvas>
            <div>
              <strong>${creature.name}</strong>
              <div style="font-size:0.72rem;color:#a5b4cf">${creature.title}</div>
              <div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:3px">${typePillsHtml}</div>
            </div>
          </div>
          <div class="stat-bars">
            <div class="stat-bar-item">
              <div class="stat-bar-head"><span>HP</span><b>${creature.stats.maxHp}</b></div>
              <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.round((creature.stats.maxHp / 220) * 100)}%;background:#4ade80"></div></div>
            </div>
            <div class="stat-bar-item">
              <div class="stat-bar-head"><span>ATK</span><b>${creature.stats.atk}</b></div>
              <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.round((creature.stats.atk / 80) * 100)}%;background:#ff5f43"></div></div>
            </div>
            <div class="stat-bar-item">
              <div class="stat-bar-head"><span>DEF</span><b>${creature.stats.def}</b></div>
              <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.round((creature.stats.def / 80) * 100)}%;background:#38bdf8"></div></div>
            </div>
            <div class="stat-bar-item">
              <div class="stat-bar-head"><span>SPD</span><b>${creature.stats.spd}</b></div>
              <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.round((creature.stats.spd / 80) * 100)}%;background:#fde047"></div></div>
            </div>
          </div>
          <div class="creature-moves-mini">
            <div><b>Forte:</b> ${sigMove.name} (CD ${sigMove.cooldown})</div>
            <div><b>Fraco:</b> ${weakMove.name} (CD 0)</div>
            <div><b>Buff:</b> ${typeDef?.buff?.name || '?'} • <b>Debuff:</b> ${typeDef?.debuff?.name || '?'}</div>
          </div>
        `;

        const previewCanvas = card.querySelector('.preview-canvas');
        window.PikamonSprites.renderCreaturePreview(previewCanvas, creature);

        card.addEventListener('click', () => {
          const cid = creature.id;
          const idx = this.selectedTeam.indexOf(cid);
          if (idx >= 0) {
            this.selectedTeam.splice(idx, 1);
          } else if (this.selectedTeam.length < 3) {
            this.selectedTeam.push(cid);
          } else {
            this.selectedTeam[2] = cid;
          }
          this.updateTeamSelectionUI();
        });

        this.creatureGrid.appendChild(card);
      }

      this.updateTeamSelectionUI();
    }

    updateMatchState(state) {
      this.matchState = state;
      if (!state) {
        this.showScreen('lobby');
        this.setQueueWaiting(false);
        return;
      }

      this.inviteBanner.classList.add('hidden');

      if (state.phase === 'waiting') {
        this.showPrivateRoomWaiting(state.roomCode);
        return;
      }

      if (state.phase === 'selecting') {
        this.activeSubmenu = null;
        this.matchOverlay.classList.add('hidden');
        this.btnRematch.disabled = false;
        this.btnRematch.textContent = 'Revanche';
        this.showScreen('select');
        this.selectRoomCode.textContent = state.roomCode;

        const me = state.players.find((p) => p.id === this.localPlayerId);
        const opp = state.players.find((p) => p.id !== this.localPlayerId);
        if (opp?.ready) {
          this.opponentDraftStatus.textContent = `${opp.nickname} já escolheu a equipe!`;
        } else {
          this.opponentDraftStatus.textContent = `${opp?.nickname || 'Oponente'} escolhendo equipe...`;
        }
        if (me?.ready) {
          this.opponentDraftStatus.textContent += ' (Você está pronto)';
          if (this.btnConfirmTeam) {
            this.btnConfirmTeam.disabled = true;
            this.btnConfirmTeam.textContent = 'Equipe Confirmada ✓';
          }
        } else {
          this.updateTeamSelectionUI();
        }
        return;
      }

      if (state.phase === 'battle' || state.phase === 'finished') {
        this.showScreen('battle');
        this.renderBattleHud();
        this.renderBattleControls();
        this.renderBattleLog();
        this.renderMatchOverlay();
      }
    }

    renderBattleHud() {
      const battle = this.matchState?.battle;
      if (!battle) return;

      this.turnBadge.textContent = `Turno ${battle.turnNumber}`;
      const isMyTurn = battle.currentTurnPlayerId === this.localPlayerId;

      if (this.matchState.phase === 'finished') {
        this.turnOwnerText.textContent = 'Partida encerrada';
        this.turnOwnerText.className = 'turn-owner';
      } else if (isMyTurn) {
        this.turnOwnerText.textContent = 'SEU TURNO — Escolha sua ação';
        this.turnOwnerText.className = 'turn-owner my-turn';
      } else {
        const current = battle.participants[battle.currentTurnPlayerId];
        this.turnOwnerText.textContent = `Turno de ${current?.nickname || 'Oponente'}...`;
        this.turnOwnerText.className = 'turn-owner enemy-turn';
      }

      // Render full team stats summary on side panel
      this.combatStatsSummary.innerHTML = '';
      const ordered = Object.values(battle.participants).sort((a) =>
        a.playerId === this.localPlayerId ? -1 : 1
      );

      for (const p of ordered) {
        const isMe = p.playerId === this.localPlayerId;
        const box = document.createElement('div');
        box.className = 'stat-unit-box';

        let teamHtml = '';
        if (Array.isArray(p.team)) {
          teamHtml = '<div style="margin-top:6px;display:flex;flex-direction:column;gap:5px;">';
          for (let i = 0; i < p.team.length; i++) {
            const member = p.team[i];
            const isAct = i === p.activeCreatureIndex;
            const isDead = member.hp <= 0;
            const statusColor = isDead ? '#ef4444' : isAct ? '#fde047' : '#4ade80';
            const roleLabel = isAct ? '★ EM CAMPO' : isDead ? '✕ DERROTADO' : '⇄ RESERVA';
            const memberTypes = Array.isArray(member.types) ? member.types : [member.type];
            const memberTypeStr = memberTypes.map(tid => this.catalog.types[tid]?.name || tid).join('/');
            teamHtml += `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:${isAct ? '#231b46' : '#0d091c'};border-left:3px solid ${statusColor};font-size:0.72rem">
                <span><b>${member.name}</b> <span style="opacity:0.7">(${memberTypeStr})</span></span>
                <span style="color:${statusColor}">${member.hp}/${member.maxHp} HP • ${roleLabel}</span>
              </div>
            `;
          }
          teamHtml += '</div>';
        }

        const activeBuffTxt = p.activeBuff ? `${p.activeBuff.name} (${p.activeBuff.remainingTurns}t)` : 'Nenhum';
        const activeDebuffTxt =
          p.activeDebuffs && p.activeDebuffs.length > 0
            ? p.activeDebuffs.map((d) => `${d.name} (${d.remainingTurns}t)`).join(', ')
            : 'Nenhum';

        box.innerHTML = `
          <div style="font-size:0.8rem"><strong>${p.nickname}</strong> ${isMe ? '(Você)' : ''}</div>
          ${teamHtml}
          <div class="stat-unit-meta" style="margin-top:6px;border-top:1px solid #2d2359;padding-top:4px;">
            Buff Ativo: ${activeBuffTxt}<br/>
            Debuffs: ${activeDebuffTxt}${p.protected ? '<br/><span style="color:#38bdf8">Escudo Ativo (85% redução)</span>' : ''}
          </div>
        `;
        this.combatStatsSummary.appendChild(box);
      }
    }

    renderBattleControls() {
      const battle = this.matchState?.battle;
      if (!battle || !this.catalog) return;

      const me = battle.participants[this.localPlayerId];
      const isBattle = this.matchState.phase === 'battle';
      const isMyTurn = isBattle && battle.currentTurnPlayerId === this.localPlayerId && !this.animating;

      this.btnForfeit.disabled = !isBattle || this.animating;

      const protectCd = me?.cooldowns?.protect ?? 0;
      this.protectSubtext.textContent = protectCd > 0 ? `Recarga: ${protectCd}t` : 'Reduz dano 85%';
      this.btnProtect.classList.toggle('is-unavailable', !isMyTurn || protectCd > 0);

      const livingBenchCount = Array.isArray(me?.team)
        ? me.team.filter((c, idx) => idx !== me.activeCreatureIndex && c.hp > 0).length
        : 0;
      if (this.switchSubtext) {
        this.switchSubtext.textContent = `${livingBenchCount} reserva(s) vivos`;
      }
      if (this.btnSwitch) {
        this.btnSwitch.classList.toggle('is-unavailable', !isMyTurn || livingBenchCount === 0);
      }

      for (const btn of this.mainButtons) {
        const menu = btn.dataset.menu;
        btn.classList.toggle('active', this.activeSubmenu === menu);
        if (menu !== 'protect') {
          btn.classList.toggle('is-unavailable', !isMyTurn);
        }
        btn.disabled = !isBattle || this.animating;
      }

      if (!this.activeSubmenu || !isBattle) {
        this.submenuPanel.classList.add('hidden');
        return;
      }

      this.submenuPanel.classList.remove('hidden');
      this.submenuList.innerHTML = '';

      if (this.activeSubmenu === 'switch') {
        this.submenuTitle.textContent = 'Trocar — Escolha uma criatura reserva para entrar';
        if (Array.isArray(me.team)) {
          for (let i = 0; i < me.team.length; i++) {
            if (i === me.activeCreatureIndex) continue;
            const c = me.team[i];
            const typeDef = this.catalog.types[c.type];
            const isFainted = c.fainted || c.hp <= 0;
            const hpRatio = Math.round((c.hp / c.maxHp) * 100);

            this.appendSubOption({
              title: `${c.name} (${typeDef?.name || c.type})`,
              tag: isFainted ? 'DESMAIADO' : `HP ${c.hp}/${c.maxHp} (${hpRatio}%)`,
              desc: isFainted
                ? 'Esta criatura foi derrotada e não pode combater.'
                : `Troca imediata: ${c.name} entra em campo. (Conta como a ação do seu turno).`,
              unavailable: !isMyTurn || isFainted,
              onClick: () => {
                if (!isMyTurn || isFainted) return;
                this.activeSubmenu = null;
                this.cb.onBattleAction({ type: 'switch', targetIndex: i });
                this.renderBattleControls();
              }
            });
          }
        }
      } else if (this.activeSubmenu === 'attack') {
        this.submenuTitle.textContent = 'Atacar — Escolha o golpe';
        const sigMove = this.catalog.moves[me.signatureMoveId];
        const weakMove = this.catalog.moves[me.weakMoveId];
        const sigCd = me.cooldowns.signature;

        this.appendSubOption({
          title: `${sigMove.name} (Assinatura)`,
          tag: sigCd > 0 ? `Recarga ${sigCd}t` : `Poder ${sigMove.power} • CD ${sigMove.cooldown}`,
          desc: sigMove.description,
          unavailable: !isMyTurn || sigCd > 0,
          onClick: () => {
            this.activeSubmenu = null;
            this.cb.onBattleAction({ type: 'attack_signature' });
            this.renderBattleControls();
          }
        });

        this.appendSubOption({
          title: `${weakMove.name} (Fraco)`,
          tag: `Poder ${weakMove.power} • Sem espera`,
          desc: weakMove.description,
          unavailable: !isMyTurn,
          onClick: () => {
            this.activeSubmenu = null;
            this.cb.onBattleAction({ type: 'attack_weak' });
            this.renderBattleControls();
          }
        });
      } else if (this.activeSubmenu === 'buffdebuff') {
        const typeDef = this.catalog.types[me.type];
        this.submenuTitle.textContent = `Buff / Debuff (${typeDef.name})`;
        const buffCd = me.cooldowns.buff;
        const debuffCd = me.cooldowns.debuff;

        this.appendSubOption({
          title: `Buff: ${typeDef.buff.name}`,
          tag: buffCd > 0 ? `Recarga ${buffCd}t` : `CD ${typeDef.buff.cooldown}t`,
          desc: typeDef.buff.description,
          unavailable: !isMyTurn || buffCd > 0,
          onClick: () => {
            this.activeSubmenu = null;
            this.cb.onBattleAction({ type: 'buff' });
            this.renderBattleControls();
          }
        });

        this.appendSubOption({
          title: `Debuff: ${typeDef.debuff.name}`,
          tag: debuffCd > 0 ? `Recarga ${debuffCd}t` : `CD ${typeDef.debuff.cooldown}t`,
          desc: typeDef.debuff.description,
          unavailable: !isMyTurn || debuffCd > 0,
          onClick: () => {
            this.activeSubmenu = null;
            this.cb.onBattleAction({ type: 'debuff' });
            this.renderBattleControls();
          }
        });
      } else if (this.activeSubmenu === 'items') {
        this.submenuTitle.textContent = 'Itens — Cura (3) & Purificação (2)';
        for (const item of this.catalog.items) {
          const qty = me.inventory[item.id] ?? 0;
          this.appendSubOption({
            title: item.name,
            tag: `x${qty}`,
            desc: item.description,
            unavailable: !isMyTurn || qty <= 0,
            onClick: () => {
              this.activeSubmenu = null;
              this.cb.onBattleAction({ type: 'item', itemId: item.id });
              this.renderBattleControls();
            }
          });
        }
      }
    }

    appendSubOption({ title, tag, desc, unavailable, onClick }) {
      const btn = document.createElement('button');
      btn.className = `sub-option-btn${unavailable ? ' is-unavailable' : ''}`;
      btn.innerHTML = `
        <div class="sub-option-head">
          <span>${title}</span>
          <span class="sub-option-tag">${tag}</span>
        </div>
        <div class="sub-option-desc">${desc}</div>
      `;
      btn.addEventListener('click', onClick);
      this.submenuList.appendChild(btn);
    }

    renderBattleLog() {
      const logs = this.matchState?.battle?.log || [];
      this.battleLog.innerHTML = '';
      for (const entry of [...logs].reverse()) {
        const li = document.createElement('li');
        li.textContent = entry;
        // Color-code effectiveness
        if (entry.includes('ULTRA EFETIVO')) {
          li.style.cssText = 'color:#f97316;font-weight:bold;text-shadow:0 0 8px #f97316';
        } else if (entry.includes('super efetivo')) {
          li.style.cssText = 'color:#fde047;font-weight:bold';
        } else if (entry.includes('muito efetivo')) {
          li.style.cssText = 'color:#94a3b8';
        } else if (entry.includes('Amortecido')) {
          li.style.cssText = 'color:#38bdf8';
        } else if (entry.includes('recuperou') || entry.includes('curou')) {
          li.style.cssText = 'color:#4ade80';
        } else if (entry.includes('desmaiou') || entry.includes('derrotado')) {
          li.style.cssText = 'color:#ef4444;font-weight:bold';
        }
        this.battleLog.appendChild(li);
      }
    }

    renderMatchOverlay() {
      if (this.matchState?.phase !== 'finished' || this.animating) {
        this.matchOverlay.classList.add('hidden');
        return;
      }

      const won = this.matchState.winnerId === this.localPlayerId;
      this.matchResultTitle.textContent = won ? 'Vitória!' : 'Derrota!';
      const reasonMap = {
        knockout: won ? 'Você derrotou a criatura adversária!' : 'Sua criatura foi derrotada.',
        forfeit: won ? 'O oponente desistiu da partida.' : 'Você desistiu da partida.',
        disconnect: 'O oponente se desconectou da sala.'
      };
      this.matchResultSubtitle.textContent = reasonMap[this.matchState.endReason] || 'Partida encerrada.';

      const canRematch = this.matchState.players.length === 2;
      this.btnRematch.classList.toggle('hidden', !canRematch);
      this.matchOverlay.classList.remove('hidden');
    }
  }

  return UI;
})();

