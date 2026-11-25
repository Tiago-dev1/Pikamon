/**
 * HTML5 Canvas battle renderer with per-move caster/receiver animations,
 * particle bursts, floating combat text, shields, and pixel HUD plates.
 */
window.BattleRenderer = (function () {
  const WIDTH = 640;
  const HEIGHT = 360;

  const PLAYER_POS = { x: 162, y: 292 };
  const ENEMY_POS = { x: 478, y: 204 };

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.canvas.width = WIDTH;
      this.canvas.height = HEIGHT;

      this.catalog = null;
      this.localPlayerId = null;
      this.matchState = null;

      // Visual HP interpolation & delayed damage trail
      this.displayedHp = {};
      this.trailHp = {};
      this.particles = [];
      this.popups = [];
      this.activeAnim = null;
      this.animQueue = [];
      this.onAnimDrain = null;

      this.lastTs = performance.now();
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }

    setCatalog(catalog) {
      this.catalog = catalog;
    }

    setLocalPlayerId(playerId) {
      this.localPlayerId = playerId;
    }

    syncState(matchState) {
      this.matchState = matchState;
      if (matchState && matchState.battle) {
        for (const [pid, p] of Object.entries(matchState.battle.participants)) {
          if (this.displayedHp[pid] === undefined) {
            this.displayedHp[pid] = p.hp;
            this.trailHp[pid] = p.hp;
          }
        }
      } else {
        this.displayedHp = {};
        this.trailHp = {};
        this.particles = [];
        this.popups = [];
        this.activeAnim = null;
        this.animQueue = [];
      }
    }

    enqueueTurnAnimation(turnResult, nextState, onComplete) {
      this.animQueue.push({
        turnResult,
        nextState,
        onComplete
      });
      if (!this.activeAnim) {
        this.startNextQueuedAnim();
      }
    }

    startNextQueuedAnim() {
      if (this.animQueue.length === 0) {
        this.activeAnim = null;
        return;
      }
      const next = this.animQueue.shift();
      const anim = next.turnResult.animation;
      const duration =
        anim?.category === 'attack_strong'
          ? 1.05
          : anim?.category === 'attack_weak' || anim?.category === 'debuff'
            ? 0.85
            : 0.78;

      this.activeAnim = {
        turnResult: next.turnResult,
        nextState: next.nextState,
        onComplete: next.onComplete,
        elapsed: 0,
        duration,
        impactTriggered: false,
        ticksTriggered: false,
        replacementTriggered: false
      };

      // If switched, snap HP to the incoming creature
      if (next.turnResult.actionType === 'switch') {
        const actorId = next.turnResult.actorId;
        const newHp = next.nextState?.battle?.participants?.[actorId]?.hp;
        if (newHp !== undefined) {
          this.displayedHp[actorId] = newHp;
          this.trailHp[actorId] = newHp;
        }
      }

      // Update state immediately for non-HP parts, while displayedHp interpolates
      this.syncStateKeepHp(next.nextState);
    }

    syncStateKeepHp(nextState) {
      const prevHp = { ...this.displayedHp };
      this.matchState = nextState;
      this.displayedHp = prevHp;
    }

    getParticipantSides() {
      if (!this.matchState || !this.matchState.battle) return { left: null, right: null };
      const participants = Object.values(this.matchState.battle.participants);
      if (participants.length < 2) return { left: null, right: null };

      let left = participants.find((p) => p.playerId === this.localPlayerId);
      let right = participants.find((p) => p.playerId !== this.localPlayerId);
      if (!left) {
        left = participants[0];
        right = participants[1];
      }
      return { left, right };
    }

    getSidePos(playerId) {
      const { left } = this.getParticipantSides();
      if (left && left.playerId === playerId) return PLAYER_POS;
      return ENEMY_POS;
    }

    spawnParticles(x, y, color, count, opts = {}) {
      const {
        speed = 90,
        upward = 0,
        gravity = 160,
        size = 4,
        life = 0.55,
        shape = 'square'
      } = opts;

      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const mag = (0.35 + Math.random() * 0.85) * speed;
        this.particles.push({
          x,
          y,
          vx: Math.cos(angle) * mag,
          vy: Math.sin(angle) * mag - upward,
          gravity,
          size: size + (Math.random() > 0.6 ? 2 : 0),
          color,
          life,
          maxLife: life,
          shape
        });
      }
    }

    spawnPopup(x, y, text, color = '#ffffff', scale = 1) {
      this.popups.push({
        x,
        y,
        vy: -34,
        text,
        color,
        scale,
        life: 1.05,
        maxLife: 1.05
      });
    }

    loop(ts) {
      const dt = Math.min(0.05, (ts - this.lastTs) / 1000);
      this.lastTs = ts;
      const timeSec = ts / 1000;

      this.update(dt, timeSec);
      this.render(timeSec);

      requestAnimationFrame(this.loop);
    }

    update(dt) {
      // Smoothly interpolate displayed HP and trailing damage bar
      if (this.matchState && this.matchState.battle) {
        for (const [pid, p] of Object.entries(this.matchState.battle.participants)) {
          const cur = this.displayedHp[pid] ?? p.hp;
          const diff = p.hp - cur;
          if (Math.abs(diff) < 0.3) {
            this.displayedHp[pid] = p.hp;
          } else {
            this.displayedHp[pid] = cur + diff * Math.min(1, dt * 9);
          }

          const trail = this.trailHp[pid] ?? p.hp;
          if (trail < this.displayedHp[pid]) {
            this.trailHp[pid] = this.displayedHp[pid];
          } else {
            this.trailHp[pid] = trail + (this.displayedHp[pid] - trail) * Math.min(1, dt * 2.8);
          }
        }
      }

      // Update active animation timeline
      if (this.activeAnim) {
        this.activeAnim.elapsed += dt;
        const p = Math.min(1, this.activeAnim.elapsed / this.activeAnim.duration);
        const anim = this.activeAnim.turnResult.animation;

        if (!this.activeAnim.impactTriggered && p >= 0.48 && anim) {
          this.activeAnim.impactTriggered = true;
          this.triggerMidAnimationEffects(anim);
        }

        if (!this.activeAnim.ticksTriggered && p >= 0.78) {
          this.activeAnim.ticksTriggered = true;
          this.triggerTickPopups(this.activeAnim.turnResult.tickEvents || []);
        }

        if (!this.activeAnim.replacementTriggered && p >= 0.72 && this.activeAnim.turnResult.replacement) {
          this.activeAnim.replacementTriggered = true;
          const rep = this.activeAnim.turnResult.replacement;
          const repPos = this.getSidePos(rep.playerId);
          const newHp = this.matchState?.battle?.participants?.[rep.playerId]?.hp;
          if (newHp !== undefined) {
            this.displayedHp[rep.playerId] = newHp;
            this.trailHp[rep.playerId] = newHp;
          }
          this.spawnParticles(repPos.x, repPos.y - 28, '#38bdf8', 22, {
            speed: 110,
            upward: 70,
            life: 0.6
          });
          this.spawnPopup(repPos.x, repPos.y - 86, `VAI, ${rep.newCreatureName}!`, '#38bdf8', 1.15);
        }

        if (this.activeAnim.elapsed >= this.activeAnim.duration) {
          const doneCb = this.activeAnim.onComplete;
          this.activeAnim = null;
          if (doneCb) doneCb();
          this.startNextQueuedAnim();
        }
      }

      // Update particles
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const pt = this.particles[i];
        pt.life -= dt;
        if (pt.life <= 0) {
          this.particles.splice(i, 1);
          continue;
        }
        pt.vy += pt.gravity * dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
      }

      // Update popups
      for (let i = this.popups.length - 1; i >= 0; i--) {
        const pop = this.popups[i];
        pop.life -= dt;
        if (pop.life <= 0) {
          this.popups.splice(i, 1);
          continue;
        }
        pop.y += pop.vy * dt;
        pop.vy *= 0.94;
      }
    }

    triggerMidAnimationEffects(anim) {
      const targetPos = this.getSidePos(anim.targetId);
      const casterPos = this.getSidePos(anim.casterId);

      if (anim.category === 'attack_strong' || anim.category === 'attack_weak') {
        const count = anim.category === 'attack_strong' ? 24 : 12;
        this.spawnParticles(targetPos.x, targetPos.y - 36, anim.color, count, {
          speed: anim.category === 'attack_strong' ? 140 : 95,
          upward: 35,
          life: 0.6
        });
        this.spawnParticles(targetPos.x, targetPos.y - 36, anim.particleColor, Math.ceil(count * 0.7), {
          speed: 110,
          upward: 50,
          life: 0.5
        });

        if (anim.shieldBlocked) {
          this.spawnParticles(targetPos.x, targetPos.y - 36, '#7dd3fc', 16, {
            speed: 115,
            gravity: 40,
            life: 0.5
          });
          this.spawnPopup(targetPos.x, targetPos.y - 84, `ESCUDO! -${anim.damage}`, '#7dd3fc', 1.1);
        } else {
          const dmgColor =
            anim.effectiveness === 'super_effective'
              ? '#fde047'
              : anim.effectiveness === 'not_very_effective'
                ? '#cbd5e1'
                : '#ff6b6b';
          this.spawnPopup(targetPos.x, targetPos.y - 82, `-${anim.damage}`, dmgColor, 1.2);
          if (anim.effectiveness === 'super_effective') {
            this.spawnPopup(targetPos.x, targetPos.y - 102, 'SUPER EFETIVO!', '#fde047', 0.9);
          } else if (anim.effectiveness === 'not_very_effective') {
            this.spawnPopup(targetPos.x, targetPos.y - 102, 'POUCO EFETIVO', '#94a3b8', 0.85);
          }
        }
      } else if (anim.category === 'buff') {
        this.spawnParticles(casterPos.x, casterPos.y - 24, anim.color, 18, {
          speed: 55,
          upward: 95,
          gravity: -20,
          life: 0.65
        });
        this.spawnParticles(casterPos.x, casterPos.y - 24, anim.particleColor, 10, {
          speed: 45,
          upward: 110,
          gravity: -30,
          life: 0.65
        });
        this.spawnPopup(casterPos.x, casterPos.y - 86, anim.label || 'BUFF!', anim.particleColor, 0.95);
      } else if (anim.category === 'debuff') {
        this.spawnParticles(targetPos.x, targetPos.y - 36, anim.color, 18, {
          speed: 75,
          upward: 25,
          gravity: 50,
          life: 0.65
        });
        this.spawnPopup(targetPos.x, targetPos.y - 86, anim.label || 'DEBUFF!', '#e879f9', 0.95);
      } else if (anim.category === 'protect') {
        this.spawnParticles(casterPos.x, casterPos.y - 34, '#38bdf8', 18, {
          speed: 70,
          gravity: 0,
          life: 0.55
        });
        this.spawnPopup(casterPos.x, casterPos.y - 86, 'ESCUDO ATIVO!', '#7dd3fc', 0.95);
      } else if (anim.category === 'item_heal') {
        this.spawnParticles(casterPos.x, casterPos.y - 26, '#4ade80', 16, {
          speed: 45,
          upward: 90,
          gravity: -15,
          size: 4,
          life: 0.65,
          shape: 'plus'
        });
        this.spawnPopup(casterPos.x, casterPos.y - 86, anim.label || '+HP', '#4ade80', 1.1);
      } else if (anim.category === 'item_cleanse') {
        this.spawnParticles(casterPos.x, casterPos.y - 30, '#38bdf8', 18, {
          speed: 95,
          upward: 55,
          gravity: 0,
          life: 0.6
        });
        this.spawnPopup(casterPos.x, casterPos.y - 86, anim.label || 'PURIFICADO!', '#a5f3fc', 0.95);
      } else if (anim.category === 'switch') {
        this.spawnParticles(casterPos.x, casterPos.y - 28, '#38bdf8', 22, {
          speed: 120,
          upward: 60,
          gravity: -20,
          life: 0.65
        });
        this.spawnParticles(casterPos.x, casterPos.y - 28, anim.color || '#fde047', 16, {
          speed: 80,
          upward: 80,
          gravity: 0,
          life: 0.55
        });
        this.spawnPopup(casterPos.x, casterPos.y - 86, `VAI, ${anim.newCreatureName || 'NOVA CRIATURA'}!`, anim.color || '#38bdf8', 1.15);
      }
    }

    triggerTickPopups(tickEvents) {
      for (const evt of tickEvents) {
        const pos = this.getSidePos(evt.targetId);
        if (evt.kind === 'hot') {
          this.spawnParticles(pos.x, pos.y - 28, '#4ade80', 8, { upward: 75, gravity: 0, life: 0.45 });
          this.spawnPopup(pos.x, pos.y - 76, `+${evt.amount} HP`, '#4ade80', 0.9);
        } else if (evt.kind === 'dot') {
          this.spawnParticles(pos.x, pos.y - 34, '#fb923c', 10, { speed: 60, life: 0.45 });
          this.spawnPopup(pos.x, pos.y - 76, `-${evt.amount} (${evt.label})`, '#fb923c', 0.85);
        }
      }
    }

    getMotionTransform(playerId, timeSec) {
      const idlePhase = playerId === this.localPlayerId ? 0 : 1.7;
      const idleBob = Math.sin(timeSec * 3.1 + idlePhase) * 2.5;
      const result = {
        dx: 0,
        dy: idleBob,
        scaleX: 1,
        scaleY: 1,
        flashColor: null,
        alpha: 1
      };

      const participant = this.matchState?.battle?.participants?.[playerId];
      if (participant && participant.hp <= 0 && !this.activeAnim) {
        result.dy = 14;
        result.scaleY = 0.72;
        result.alpha = 0.35;
        return result;
      }

      if (!this.activeAnim || !this.activeAnim.turnResult.animation) {
        return result;
      }

      const anim = this.activeAnim.turnResult.animation;
      const p = Math.min(1, this.activeAnim.elapsed / this.activeAnim.duration);
      const isLeft = this.getSidePos(playerId) === PLAYER_POS;
      const dir = isLeft ? 1 : -1;

      if (playerId === anim.casterId) {
        if (anim.category === 'attack_strong' || anim.category === 'attack_weak') {
          const lungeDist = anim.category === 'attack_strong' ? 46 : 26;
          if (p < 0.25) {
            const k = p / 0.25;
            result.dx = -dir * 8 * k;
            result.scaleX = 1 + 0.1 * k;
            result.scaleY = 1 - 0.08 * k;
          } else if (p < 0.5) {
            const k = (p - 0.25) / 0.25;
            result.dx = dir * lungeDist * k;
            result.dy -= Math.sin(k * Math.PI) * (anim.category === 'attack_strong' ? 20 : 8);
          } else {
            const k = 1 - (p - 0.5) / 0.5;
            result.dx = dir * lungeDist * k;
          }
        } else if (anim.category === 'buff' || anim.category === 'item_heal' || anim.category === 'item_cleanse') {
          result.dy -= Math.sin(p * Math.PI) * 14;
          const pulse = 1 + Math.sin(p * Math.PI * 2) * 0.08;
          result.scaleX = pulse;
          result.scaleY = 2 - pulse;
        } else if (anim.category === 'protect') {
          result.scaleX = 1 + Math.sin(p * Math.PI) * 0.1;
          result.scaleY = 1 - Math.sin(p * Math.PI) * 0.08;
        } else if (anim.category === 'debuff') {
          result.dx = dir * Math.sin(p * Math.PI) * 14;
        } else if (anim.category === 'forfeit') {
          result.alpha = Math.max(0.25, 1 - p * 0.75);
          result.dy += p * 16;
        }
      }

      if (playerId === anim.targetId && anim.casterId !== anim.targetId) {
        if ((anim.category === 'attack_strong' || anim.category === 'attack_weak') && p >= 0.44 && p <= 0.84) {
          const shakeAmp = anim.shieldBlocked ? 4 : anim.category === 'attack_strong' ? 12 : 7;
          result.dx = Math.sin(p * 72) * shakeAmp;
          if (!anim.shieldBlocked && Math.floor(p * 30) % 2 === 0) {
            result.flashColor = '#ffffff';
          }
        } else if (anim.category === 'debuff' && p >= 0.45 && p <= 0.85) {
          result.dx = Math.sin(p * 55) * 5;
          result.scaleY = 0.92;
        }
      }

      return result;
    }

    computeScreenShake() {
      if (!this.activeAnim || !this.activeAnim.turnResult.animation) return { x: 0, y: 0 };
      const anim = this.activeAnim.turnResult.animation;
      const p = this.activeAnim.elapsed / this.activeAnim.duration;
      if (anim.category === 'attack_strong' && !anim.shieldBlocked && p >= 0.45 && p <= 0.75) {
        const mag = (1 - (p - 0.45) / 0.3) * 6;
        return {
          x: (Math.random() - 0.5) * mag * 2,
          y: (Math.random() - 0.5) * mag * 2
        };
      }
      return { x: 0, y: 0 };
    }

    render(timeSec) {
      const ctx = this.ctx;
      ctx.imageSmoothingEnabled = false;

      const shake = this.computeScreenShake();
      ctx.save();
      ctx.translate(Math.round(shake.x), Math.round(shake.y));

      window.PikamonSprites.drawArenaBackground(ctx, WIDTH, HEIGHT, timeSec);

      const { left, right } = this.getParticipantSides();
      if (!left || !right || !this.catalog) {
        this.drawWaitingOverlay(ctx, timeSec);
        ctx.restore();
        return;
      }

      const leftCreature = this.catalog.creatures.find((c) => c.id === left.creatureId);
      const rightCreature = this.catalog.creatures.find((c) => c.id === right.creatureId);
      const leftTypeColor = this.catalog.types[left.type]?.color;
      const rightTypeColor = this.catalog.types[right.type]?.color;

      const activePlayerId = this.matchState.phase === 'battle' ? this.matchState.battle.currentTurnPlayerId : null;

      // Platforms
      window.PikamonSprites.drawPlatform(
        ctx,
        PLAYER_POS.x,
        PLAYER_POS.y + 4,
        74,
        15,
        leftTypeColor,
        activePlayerId === left.playerId
      );
      window.PikamonSprites.drawPlatform(
        ctx,
        ENEMY_POS.x,
        ENEMY_POS.y + 4,
        64,
        13,
        rightTypeColor,
        activePlayerId === right.playerId
      );

      // Draw creatures
      this.drawCreatureUnit(ctx, left, leftCreature, PLAYER_POS, true, timeSec);
      this.drawCreatureUnit(ctx, right, rightCreature, ENEMY_POS, false, timeSec);

      // Draw mid-flight move VFX (projectiles, lightning, beams, waves, etc.)
      if (this.activeAnim && this.activeAnim.turnResult.animation) {
        this.drawMoveVfx(ctx, this.activeAnim.turnResult.animation, this.activeAnim.elapsed / this.activeAnim.duration);
      }

      // Draw particles
      for (const pt of this.particles) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
        ctx.fillStyle = pt.color;
        if (pt.shape === 'plus') {
          ctx.fillRect(Math.round(pt.x - 3), Math.round(pt.y - 1), 6, 2);
          ctx.fillRect(Math.round(pt.x - 1), Math.round(pt.y - 3), 2, 6);
        } else {
          ctx.fillRect(Math.round(pt.x), Math.round(pt.y), pt.size, pt.size);
        }
        ctx.restore();
      }

      // Draw floating text popups
      for (const pop of this.popups) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, (pop.life / pop.maxLife) * 1.4);
        ctx.font = `bold ${Math.round(13 * pop.scale)}px "Courier New", monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#0f0c1d';
        ctx.fillText(pop.text, Math.round(pop.x) + 2, Math.round(pop.y) + 2);
        ctx.fillStyle = pop.color;
        ctx.fillText(pop.text, Math.round(pop.x), Math.round(pop.y));
        ctx.restore();
      }

      // Draw Pixel HUD Plates on Canvas
      this.drawHudPlate(ctx, left, 16, 16, true);
      this.drawHudPlate(ctx, right, WIDTH - 244, 16, false);

      ctx.restore();
    }

    drawCreatureUnit(ctx, participant, creature, pos, isPlayerSide, timeSec) {
      if (!creature) return;
      const motion = this.getMotionTransform(participant.playerId, timeSec);
      const pixelSize = isPlayerSide ? 5 : 4;

      // Ground shadow
      ctx.save();
      ctx.fillStyle = 'rgba(10, 8, 20, 0.45)';
      ctx.fillRect(pos.x - 28, pos.y - 2, 56, 6);
      ctx.restore();

      window.PikamonSprites.drawPixelSprite(
        ctx,
        creature.sprite,
        pos.x + motion.dx,
        pos.y + motion.dy,
        pixelSize,
        {
          flipX: isPlayerSide,
          scaleX: motion.scaleX,
          scaleY: motion.scaleY,
          flashColor: motion.flashColor,
          alpha: motion.alpha
        }
      );

      // Persistent Shield visual if protected
      if (participant.protected && participant.hp > 0) {
        const pulse = Math.sin(timeSec * 6) * 2;
        ctx.save();
        ctx.strokeStyle = '#7dd3fc';
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.72;
        ctx.strokeRect(
          Math.round(pos.x - 42 - pulse / 2),
          Math.round(pos.y - 78 - pulse / 2),
          84 + pulse,
          80 + pulse
        );
        ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
        ctx.fillRect(Math.round(pos.x - 42), Math.round(pos.y - 78), 84, 80);
        ctx.restore();
      }

      // Subtle buff aura indicator
      if (participant.activeBuff && participant.hp > 0 && Math.random() < 0.12) {
        const buffColor = this.catalog.types[participant.type]?.accentColor || '#fde047';
        this.spawnParticles(pos.x + (Math.random() - 0.5) * 44, pos.y - 14, buffColor, 1, {
          speed: 10,
          upward: 45,
          gravity: -10,
          size: 3,
          life: 0.45
        });
      }

      // Subtle debuff indicator motes
      if (participant.activeDebuffs.length > 0 && participant.hp > 0 && Math.random() < 0.14) {
        this.spawnParticles(pos.x + (Math.random() - 0.5) * 40, pos.y - 46, '#c084fc', 1, {
          speed: 14,
          upward: 20,
          gravity: 10,
          size: 3,
          life: 0.4
        });
      }
    }

    drawMoveVfx(ctx, anim, p) {
      const from = this.getSidePos(anim.casterId);
      const to = this.getSidePos(anim.targetId);
      const startX = from.x;
      const startY = from.y - 34;
      const endX = to.x;
      const endY = to.y - 34;

      if (anim.category === 'attack_weak') {
        if (p >= 0.18 && p <= 0.52) {
          const t = (p - 0.18) / 0.34;
          const x = startX + (endX - startX) * t;
          const y = startY + (endY - startY) * t - Math.sin(t * Math.PI) * 18;
          ctx.fillStyle = anim.color;
          ctx.fillRect(Math.round(x - 7), Math.round(y - 7), 14, 14);
          ctx.fillStyle = anim.particleColor;
          ctx.fillRect(Math.round(x - 3), Math.round(y - 3), 6, 6);
        }
      } else if (anim.category === 'attack_strong') {
        if (p >= 0.15 && p <= 0.55) {
          const t = (p - 0.15) / 0.40;
          ctx.save();
          if (anim.style === 'thunder_strike') {
            ctx.strokeStyle = anim.color;
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(endX - 10, 0);
            ctx.lineTo(endX + 12, endY * 0.4);
            ctx.lineTo(endX - 14, endY * 0.72);
            ctx.lineTo(endX, endY);
            ctx.stroke();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
          } else if (anim.style === 'boulder_drop' || anim.style === 'meteor_slam') {
            const dropY = -20 + (endY + 20) * t;
            const dropX = anim.style === 'meteor_slam' ? startX + (endX - startX) * t : endX;
            ctx.fillStyle = anim.color;
            ctx.fillRect(Math.round(dropX - 14), Math.round(dropY - 14), 28, 28);
            ctx.fillStyle = anim.particleColor;
            ctx.fillRect(Math.round(dropX - 8), Math.round(dropY - 8), 16, 16);
          } else if (anim.style === 'vine_eruption' || anim.style === 'quake_slam') {
            const riseH = Math.round(Math.sin(t * Math.PI) * 64);
            ctx.fillStyle = anim.color;
            ctx.fillRect(endX - 24, to.y - riseH, 12, riseH);
            ctx.fillRect(endX - 4, to.y - riseH - 12, 12, riseH + 12);
            ctx.fillRect(endX + 16, to.y - riseH + 6, 12, Math.max(4, riseH - 6));
          } else if (anim.style === 'tidal_wave') {
            const x = startX + (endX - startX) * t;
            const waveH = 26 + Math.sin(t * Math.PI) * 18;
            ctx.fillStyle = anim.color;
            ctx.fillRect(Math.round(x - 16), Math.round(endY - waveH / 2), 32, waveH);
            ctx.fillStyle = anim.particleColor;
            ctx.fillRect(Math.round(x - 12), Math.round(endY - waveH / 2), 24, 6);
          } else if (anim.style === 'cyclone_burst') {
            const x = startX + (endX - startX) * t;
            const y = startY + (endY - startY) * t;
            const spin = Math.sin(t * 28) * 10;
            ctx.strokeStyle = anim.color;
            ctx.lineWidth = 3;
            ctx.strokeRect(Math.round(x - 14 + spin * 0.4), Math.round(y - 22), 28, 12);
            ctx.strokeStyle = anim.particleColor;
            ctx.strokeRect(Math.round(x - 10 - spin * 0.4), Math.round(y - 4), 20, 12);
          } else {
            // aurora_lance diagonal boreal beam
            ctx.strokeStyle = anim.color;
            ctx.lineWidth = 8;
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(startX + (endX - startX) * t, startY + (endY - startY) * t);
            ctx.stroke();
            ctx.strokeStyle = anim.particleColor;
            ctx.lineWidth = 3;
            ctx.stroke();
          }
          ctx.restore();
        }
      } else if (anim.category === 'debuff') {
        if (p >= 0.15 && p <= 0.55) {
          const t = (p - 0.15) / 0.40;
          const x = startX + (endX - startX) * t;
          const y = startY + (endY - startY) * t - Math.sin(t * Math.PI) * 32;
          ctx.fillStyle = anim.color;
          ctx.fillRect(Math.round(x - 6), Math.round(y - 6), 12, 12);
          ctx.fillStyle = '#181425';
          ctx.fillRect(Math.round(x - 2), Math.round(y - 2), 4, 4);
        }
      } else if (anim.category === 'buff' || anim.category === 'protect') {
        const radius = 16 + p * 36;
        ctx.save();
        ctx.strokeStyle = anim.particleColor;
        ctx.globalAlpha = 1 - p;
        ctx.lineWidth = 2;
        ctx.strokeRect(
          Math.round(startX - radius),
          Math.round(from.y - 36 - radius * 0.8),
          Math.round(radius * 2),
          Math.round(radius * 1.6)
        );
        ctx.restore();
      }
    }

    drawHudPlate(ctx, participant, x, y, isLocal) {
      const w = 236;
      const h = 72;
      const typeDef = this.catalog.types[participant.type];
      const dispHp = Math.max(0, Math.round(this.displayedHp[participant.playerId] ?? participant.hp));
      const trailHp = Math.max(dispHp, this.trailHp[participant.playerId] ?? dispHp);
      const hpRatio = Math.max(0, Math.min(1, dispHp / participant.maxHp));
      const trailRatio = Math.max(0, Math.min(1, trailHp / participant.maxHp));

      ctx.save();
      // Drop shadow & retro RPG frame
      ctx.fillStyle = '#070510';
      ctx.fillRect(x + 3, y + 3, w, h);

      ctx.fillStyle = '#130f26';
      ctx.fillRect(x, y, w, h);

      ctx.strokeStyle = isLocal ? '#fde047' : '#64748b';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

      // Inner subtle bezel
      ctx.strokeStyle = '#2d2552';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);

      // Corner pixel rivets
      ctx.fillStyle = isLocal ? '#fde047' : '#94a3b8';
      ctx.fillRect(x + 3, y + 3, 3, 3);
      ctx.fillRect(x + w - 6, y + 3, 3, 3);
      ctx.fillRect(x + 3, y + h - 6, 3, 3);
      ctx.fillRect(x + w - 6, y + h - 6, 3, 3);

      // Name & Trainer tag
      ctx.font = 'bold 12px "Courier New", monospace';
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'left';
      ctx.fillText(`${participant.name}`, x + 11, y + 20);

      ctx.font = '10px "Courier New", monospace';
      ctx.fillStyle = isLocal ? '#fde047' : '#94a3b8';
      ctx.fillText(isLocal ? 'VOCÊ' : participant.nickname.slice(0, 14), x + 11, y + 32);

      // 3-Creature Team status dots / pokeball capsules
      if (Array.isArray(participant.team) && participant.team.length > 0) {
        const teamStartX = x + 98;
        const teamY = y + 23;
        for (let i = 0; i < participant.team.length; i++) {
          const tc = participant.team[i];
          const dotX = teamStartX + i * 16;
          const isCurrent = tc.isActive || i === participant.activeCreatureIndex;
          const isFainted = tc.fainted || tc.hp <= 0;

          ctx.fillStyle = '#070510';
          ctx.fillRect(dotX - 1, teamY - 1, 12, 12);

          if (isFainted) {
            ctx.fillStyle = '#332940';
            ctx.fillRect(dotX, teamY, 10, 10);
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(dotX + 3, teamY + 3, 4, 4);
          } else if (isCurrent) {
            ctx.fillStyle = '#fde047';
            ctx.fillRect(dotX, teamY, 10, 10);
            ctx.fillStyle = '#22c55e';
            ctx.fillRect(dotX + 2, teamY + 2, 6, 6);
          } else {
            ctx.fillStyle = '#4ade80';
            ctx.fillRect(dotX, teamY, 10, 10);
            ctx.fillStyle = '#14532d';
            ctx.fillRect(dotX + 3, teamY + 3, 4, 4);
          }
        }
      }

      // Type badge(s) — supports dual types
      const participantTypes = Array.isArray(participant.types) && participant.types.length > 0
        ? participant.types : [participant.type];
      ctx.font = 'bold 9px "Courier New", monospace';
      ctx.textAlign = 'center';
      const badgeW = participantTypes.length > 1 ? 29 : 59;
      participantTypes.forEach((tid, idx) => {
        const td = this.catalog.types[tid];
        if (!td) return;
        const bx = x + w - 70 + idx * (badgeW + 1);
        ctx.fillStyle = td.color;
        ctx.fillRect(bx, y + 9, badgeW, 15);
        ctx.fillStyle = '#0f0c1d';
        ctx.fillText(td.name.slice(0, 4).toUpperCase(), bx + badgeW / 2, y + 20);
      });

      // Segmented HP Bar with delayed white damage trail
      const barX = x + 11;
      const barY = y + 39;
      const barW = w - 22;
      const barH = 11;

      ctx.fillStyle = '#0b0816';
      ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
      ctx.fillStyle = '#1f1a38';
      ctx.fillRect(barX, barY, barW, barH);

      // Trail bar
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(barX, barY, Math.round(barW * trailRatio), barH);

      // Actual HP fill
      ctx.fillStyle = hpRatio > 0.5 ? '#4ade80' : hpRatio > 0.25 ? '#facc15' : '#ef4444';
      ctx.fillRect(barX, barY, Math.round(barW * hpRatio), barH);

      // Top shine on HP bar
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.fillRect(barX, barY, Math.round(barW * hpRatio), 3);

      // Segment ticks
      ctx.fillStyle = 'rgba(13, 9, 28, 0.45)';
      for (let sx = barX + 26; sx < barX + barW - 4; sx += 26) {
        ctx.fillRect(sx, barY, 2, barH);
      }

      // HP Numbers & active status tags
      ctx.font = 'bold 10px "Courier New", monospace';
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'left';
      ctx.fillText(`HP ${dispHp}/${participant.maxHp}`, x + 11, y + 62);

      const badges = [];
      if (participant.protected) badges.push({ label: 'ESC', color: '#38bdf8' });
      if (participant.activeBuff) badges.push({ label: `BUF:${participant.activeBuff.remainingTurns}`, color: '#4ade80' });
      if (participant.activeDebuffs.length > 0) {
        badges.push({ label: `DEB:${participant.activeDebuffs.length}`, color: '#e879f9' });
      }

      let bx = x + w - 11;
      ctx.textAlign = 'right';
      for (const b of badges.reverse()) {
        ctx.fillStyle = b.color;
        ctx.fillText(b.label, bx, y + 62);
        bx -= ctx.measureText(b.label).width + 6;
      }

      ctx.restore();
    }

    drawWaitingOverlay(ctx, timeSec) {
      ctx.save();
      ctx.fillStyle = 'rgba(15, 12, 29, 0.55)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.font = 'bold 16px "Courier New", monospace';
      ctx.fillStyle = '#fde047';
      ctx.textAlign = 'center';
      const dots = '.'.repeat((Math.floor(timeSec * 2) % 3) + 1);
      ctx.fillText(`PREPARANDO ARENA${dots}`, WIDTH / 2, HEIGHT / 2);
      ctx.restore();
    }
  }

  return Renderer;
})();
