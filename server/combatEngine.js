/**
 * Server-authoritative combat engine for 3v3 creature battles.
 * Validates player turn, cooldowns, item stock, creature switching, and computes all combat outcomes.
 */

class CombatError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Creates a battle-ready state for a single creature.
 */
function createCreatureState(creature) {
  const types = Array.isArray(creature.types) && creature.types.length > 0
    ? [...creature.types]
    : [creature.type || 'fogo'];

  return {
    creatureId: creature.id,
    name: creature.name,
    title: creature.title,
    type: types[0],
    types,
    maxHp: creature.stats.maxHp,
    hp: creature.stats.maxHp,
    baseStats: { ...creature.stats },
    signatureMoveId: creature.signatureMoveId,
    weakMoveId: creature.weakMoveId,
    cooldowns: {
      signature: 0,
      buff: 0,
      debuff: 0,
      protect: 0
    },
    activeBuff: null,
    activeDebuffs: [],
    protected: false,
    fainted: false
  };
}

/**
 * Syncs the active creature's attributes onto the participant root
 * for backwards-compatibility with existing HUD and render references.
 */
function syncActiveCreatureMirror(participant) {
  const active = participant.team[participant.activeCreatureIndex];
  if (!active) return;

  participant.creatureId = active.creatureId;
  participant.name = active.name;
  participant.title = active.title;
  participant.type = active.type;
  participant.types = Array.isArray(active.types) ? active.types : [active.type];
  participant.maxHp = active.maxHp;
  participant.hp = active.hp;
  participant.baseStats = active.baseStats;
  participant.signatureMoveId = active.signatureMoveId;
  participant.weakMoveId = active.weakMoveId;
  participant.cooldowns = active.cooldowns;
  participant.activeBuff = active.activeBuff;
  participant.activeDebuffs = active.activeDebuffs;
  participant.protected = active.protected;
  participant.fainted = active.fainted;
}

/**
 * Creates a fresh battle participant state with a team of 3 creatures from JSON definitions.
 */
function createParticipantState(player, gameData) {
  const teamCreatureIds = Array.isArray(player.team) && player.team.length > 0
    ? player.team
    : [player.creatureId || 'pyrokit'];

  const team = [];
  for (const cid of teamCreatureIds.slice(0, 3)) {
    const creature = gameData.creaturesById[cid];
    if (!creature) {
      throw new CombatError('CREATURE_NOT_FOUND', `Criatura "${cid}" não encontrada.`);
    }
    team.push(createCreatureState(creature));
  }

  // Ensure 3 creatures by filling defaults if fewer were provided
  while (team.length < 3) {
    const fallbackCreatures = ['pyrokit', 'aquafin', 'florabrot'];
    const fallback = gameData.creaturesById[fallbackCreatures[team.length] || 'pyrokit'];
    team.push(createCreatureState(fallback));
  }

  const inventory = {};
  for (const item of gameData.itemsList) {
    inventory[item.id] = item.quantity;
  }

  const participant = {
    playerId: player.id,
    nickname: player.nickname,
    team,
    activeCreatureIndex: 0,
    inventory
  };

  syncActiveCreatureMirror(participant);
  return participant;
}

/**
 * Computes effective ATK, DEF, and SPD for a creature after applying active buffs and debuffs.
 */
function computeEffectiveStats(creatureOrParticipant) {
  const c = creatureOrParticipant.team
    ? creatureOrParticipant.team[creatureOrParticipant.activeCreatureIndex]
    : creatureOrParticipant;

  if (!c) {
    return { atk: 50, def: 50, spd: 50 };
  }

  let atkMul = 1.0;
  let defMul = 1.0;
  let spdMul = 1.0;

  if (c.activeBuff) {
    atkMul *= c.activeBuff.modifiers.atkMul ?? 1.0;
    defMul *= c.activeBuff.modifiers.defMul ?? 1.0;
    spdMul *= c.activeBuff.modifiers.spdMul ?? 1.0;
  }

  for (const debuff of c.activeDebuffs || []) {
    atkMul *= debuff.modifiers.atkMul ?? 1.0;
    defMul *= debuff.modifiers.defMul ?? 1.0;
    spdMul *= debuff.modifiers.spdMul ?? 1.0;
  }

  return {
    atk: Math.max(10, Math.round(c.baseStats.atk * Math.max(0.35, atkMul))),
    def: Math.max(10, Math.round(c.baseStats.def * Math.max(0.35, defMul))),
    spd: Math.max(10, Math.round(c.baseStats.spd * Math.max(0.35, spdMul)))
  };
}

function getEffectiveness(moveType, targetTypeOrTypes, gameData) {
  const typeDef = gameData.typesById[moveType];
  if (!typeDef || !typeDef.effectiveness) return 1.0;
  const types = Array.isArray(targetTypeOrTypes) ? targetTypeOrTypes : [targetTypeOrTypes];
  let multiplier = 1.0;
  for (const t of types) {
    if (t) {
      multiplier *= (typeDef.effectiveness[t] ?? 1.0);
    }
  }
  return multiplier;
}

function getEffectivenessLabel(multiplier) {
  if (multiplier >= 1.9) return 'ultra_effective';
  if (multiplier >= 1.35) return 'super_effective';
  if (multiplier <= 0.75) return 'not_very_effective';
  return 'neutral';
}

function tickCooldownsAndEffectsAtTurnEnd(activeCreature, playerId, usedKey, justAppliedBuff, gameData) {
  const logs = [];
  const tickEvents = [];

  for (const key of Object.keys(activeCreature.cooldowns)) {
    if (key === usedKey) continue;
    if (activeCreature.cooldowns[key] > 0) {
      activeCreature.cooldowns[key] -= 1;
    }
  }

  if (activeCreature.activeBuff) {
    if (!justAppliedBuff && activeCreature.activeBuff.modifiers.hot > 0 && activeCreature.hp > 0) {
      const heal = Math.min(activeCreature.maxHp - activeCreature.hp, activeCreature.activeBuff.modifiers.hot);
      if (heal > 0) {
        activeCreature.hp += heal;
        logs.push(`${activeCreature.name} recuperou ${heal} HP com ${activeCreature.activeBuff.name}.`);
        tickEvents.push({ targetId: playerId, kind: 'hot', amount: heal, label: activeCreature.activeBuff.name });
      }
    }

    if (!justAppliedBuff) {
      activeCreature.activeBuff.remainingTurns -= 1;
      if (activeCreature.activeBuff.remainingTurns <= 0) {
        logs.push(`O efeito ${activeCreature.activeBuff.name} em ${activeCreature.name} acabou.`);
        activeCreature.activeBuff = null;
      }
    }
  }

  const remainingDebuffs = [];
  for (const debuff of activeCreature.activeDebuffs) {
    if (debuff.modifiers.dot > 0 && activeCreature.hp > 0) {
      const dmg = Math.min(activeCreature.hp, debuff.modifiers.dot);
      activeCreature.hp -= dmg;
      logs.push(`${activeCreature.name} sofreu ${dmg} de dano por ${debuff.name}.`);
      tickEvents.push({ targetId: playerId, kind: 'dot', amount: dmg, label: debuff.name });
    }

    debuff.remainingTurns -= 1;
    if (debuff.remainingTurns > 0) {
      remainingDebuffs.push(debuff);
    } else {
      logs.push(`${debuff.name} em ${activeCreature.name} dissipou-se.`);
    }
  }
  activeCreature.activeDebuffs = remainingDebuffs;

  return { logs, tickEvents };
}

/**
 * Checks if a participant has any non-fainted creatures remaining.
 */
function hasAliveCreatures(participant) {
  return participant.team.some((c) => c.hp > 0);
}

/**
 * Gets the index of the next alive bench creature.
 */
function getNextAliveCreatureIndex(participant) {
  return participant.team.findIndex((c) => c.hp > 0);
}

/**
 * Validates and executes a single turn action on the match state.
 * Mutates match.battle in place and returns a turnResult object for broadcast.
 */
function executeTurnAction(match, playerId, payload, gameData) {
  if (!match || match.phase !== 'battle' || !match.battle) {
    throw new CombatError('MATCH_NOT_ACTIVE', 'A partida não está em combate no momento.');
  }

  const battle = match.battle;
  const actor = battle.participants[playerId];
  if (!actor) {
    throw new CombatError('PLAYER_NOT_IN_MATCH', 'Você não faz parte desta partida.');
  }

  if (!payload || typeof payload.type !== 'string') {
    throw new CombatError('INVALID_PAYLOAD', 'Ação inválida ou malformada.');
  }

  const opponentId = Object.keys(battle.participants).find((id) => id !== playerId);
  const opponent = battle.participants[opponentId];

  const activeActorCreature = actor.team[actor.activeCreatureIndex];
  const activeOpponentCreature = opponent.team[opponent.activeCreatureIndex];

  // Forfeit is allowed at any moment during battle
  if (payload.type === 'forfeit') {
    match.phase = 'finished';
    match.winnerId = opponentId;
    match.endReason = 'forfeit';
    const log = `${actor.nickname} (${activeActorCreature.name}) desistiu da batalha!`;
    battle.log.push(log);

    return {
      turnNumber: battle.turnNumber,
      actorId: playerId,
      targetId: opponentId,
      actionType: 'forfeit',
      actionName: 'Desistir',
      logs: [log],
      tickEvents: [],
      animation: {
        category: 'forfeit',
        style: 'forfeit',
        color: '#ef4444',
        particleColor: '#fca5a5',
        casterId: playerId,
        targetId: opponentId
      },
      winnerId: opponentId,
      endReason: 'forfeit'
    };
  }

  if (battle.currentTurnPlayerId !== playerId) {
    throw new CombatError('OUT_OF_TURN', 'Aguarde o seu turno para agir.');
  }

  // Temporary shield expires at the start of the protected player's next turn
  if (activeActorCreature.protected) {
    activeActorCreature.protected = false;
  }

  let usedCooldownKey = null;
  let justAppliedBuff = false;
  const logs = [];
  let animation = null;
  let replacement = null;

  switch (payload.type) {
    case 'switch': {
      const targetIndex = Number(payload.targetIndex);
      if (isNaN(targetIndex) || targetIndex < 0 || targetIndex >= actor.team.length) {
        throw new CombatError('INVALID_SWITCH_TARGET', 'Índice de criatura inválido para troca.');
      }
      if (targetIndex === actor.activeCreatureIndex) {
        throw new CombatError('ALREADY_ACTIVE', 'Esta criatura já está em campo.');
      }
      const targetCreature = actor.team[targetIndex];
      if (targetCreature.hp <= 0 || targetCreature.fainted) {
        throw new CombatError('CREATURE_FAINTED', `${targetCreature.name} está desmaiado e não pode lutar.`);
      }

      const oldCreature = activeActorCreature;
      // Switching out clears temporary shield, active buff, and debuffs
      oldCreature.protected = false;
      oldCreature.activeBuff = null;
      oldCreature.activeDebuffs = [];

      actor.activeCreatureIndex = targetIndex;
      syncActiveCreatureMirror(actor);
      const newCreature = actor.team[targetIndex];

      const typeDef = gameData.typesById[newCreature.type];
      logs.push(`${actor.nickname} recolheu ${oldCreature.name} e enviou ${newCreature.name}!`);

      animation = {
        category: 'switch',
        style: 'switch_send',
        color: typeDef?.color || '#38bdf8',
        particleColor: typeDef?.accentColor || '#ffffff',
        casterId: playerId,
        targetId: playerId,
        oldCreatureId: oldCreature.creatureId,
        newCreatureId: newCreature.creatureId,
        newCreatureName: newCreature.name,
        targetIndex
      };
      break;
    }

    case 'attack_weak':
    case 'attack_signature': {
      const isSignature = payload.type === 'attack_signature';
      const moveId = isSignature ? activeActorCreature.signatureMoveId : activeActorCreature.weakMoveId;
      const move = gameData.movesById[moveId];

      if (!move) {
        throw new CombatError('MOVE_NOT_FOUND', 'Golpe não encontrado nos dados.');
      }

      if (isSignature && activeActorCreature.cooldowns.signature > 0) {
        throw new CombatError(
          'ON_COOLDOWN',
          `${move.name} está em recarga por mais ${activeActorCreature.cooldowns.signature} turno(s).`
        );
      }

      const atkStats = computeEffectiveStats(activeActorCreature);
      const defStats = computeEffectiveStats(activeOpponentCreature);

      // STAB: se o tipo do golpe estiver em qualquer um dos tipos da criatura atacante
      const actorTypes = Array.isArray(activeActorCreature.types) && activeActorCreature.types.length > 0
        ? activeActorCreature.types : [activeActorCreature.type];
      const stab = actorTypes.includes(move.type) ? 1.15 : 1.0;

      // Efetividade contra todos os tipos do defensor (tipo duplo multiplica)
      const defenderTypes = Array.isArray(activeOpponentCreature.types) && activeOpponentCreature.types.length > 0
        ? activeOpponentCreature.types : [activeOpponentCreature.type];
      const effectiveness = getEffectiveness(move.type, defenderTypes, gameData);
      const effLabel = getEffectivenessLabel(effectiveness);
      const variance = 0.92 + Math.random() * 0.16;

      const rawDamage = Math.max(
        4,
        Math.round(move.power * (atkStats.atk / defStats.def) * 0.48 * stab * effectiveness * variance)
      );

      let finalDamage = rawDamage;
      let shieldBlocked = false;
      if (activeOpponentCreature.protected) {
        const reduction = gameData.protectConfig.damageReduction ?? 0.85;
        finalDamage = Math.max(1, Math.round(rawDamage * (1 - reduction)));
        activeOpponentCreature.protected = false;
        shieldBlocked = true;
      }

      activeOpponentCreature.hp = Math.max(0, activeOpponentCreature.hp - finalDamage);

      if (isSignature) {
        activeActorCreature.cooldowns.signature = move.cooldown;
        usedCooldownKey = 'signature';
      }

      let msg = `${activeActorCreature.name} usou ${move.name} e causou ${finalDamage} de dano em ${activeOpponentCreature.name}!`;
      if (shieldBlocked) {
        msg += ' (Amortecido pelo escudo!)';
      } else if (effLabel === 'ultra_effective') {
        msg += ' É ULTRA EFETIVO!! (tipo duplo)';
      } else if (effLabel === 'super_effective') {
        msg += ' É super efetivo!';
      } else if (effLabel === 'not_very_effective') {
        msg += ' Não é muito efetivo...';
      } else if (effectiveness <= 0.3) {
        msg += ' Praticamente não surtiu efeito!';
      }
      logs.push(msg);

      animation = {
        category: isSignature ? 'attack_strong' : 'attack_weak',
        style: move.animation.style,
        color: move.animation.color,
        particleColor: move.animation.particleColor,
        casterId: playerId,
        targetId: opponentId,
        damage: finalDamage,
        effectiveness: effLabel,
        shieldBlocked
      };
      break;
    }

    case 'buff': {
      const typeDef = gameData.typesById[activeActorCreature.type];
      const buffDef = typeDef?.buff;
      if (!buffDef) {
        throw new CombatError('MOVE_NOT_FOUND', 'Buff elemental não encontrado.');
      }
      if (activeActorCreature.cooldowns.buff > 0) {
        throw new CombatError(
          'ON_COOLDOWN',
          `${buffDef.name} está em recarga por mais ${activeActorCreature.cooldowns.buff} turno(s).`
        );
      }

      activeActorCreature.activeBuff = {
        id: buffDef.id,
        name: buffDef.name,
        description: buffDef.description,
        remainingTurns: buffDef.duration,
        modifiers: { ...buffDef.modifiers }
      };
      activeActorCreature.cooldowns.buff = buffDef.cooldown;
      usedCooldownKey = 'buff';
      justAppliedBuff = true;

      logs.push(`${activeActorCreature.name} ativou ${buffDef.name}! (${buffDef.description})`);
      animation = {
        category: 'buff',
        style: buffDef.animation.style,
        color: buffDef.animation.color,
        particleColor: buffDef.animation.particleColor,
        casterId: playerId,
        targetId: playerId,
        label: buffDef.name
      };
      break;
    }

    case 'debuff': {
      const typeDef = gameData.typesById[activeActorCreature.type];
      const debuffDef = typeDef?.debuff;
      if (!debuffDef) {
        throw new CombatError('MOVE_NOT_FOUND', 'Debuff elemental não encontrado.');
      }
      if (activeActorCreature.cooldowns.debuff > 0) {
        throw new CombatError(
          'ON_COOLDOWN',
          `${debuffDef.name} está em recarga por mais ${activeActorCreature.cooldowns.debuff} turno(s).`
        );
      }

      const existingIdx = activeOpponentCreature.activeDebuffs.findIndex((d) => d.id === debuffDef.id);
      const debuffInstance = {
        id: debuffDef.id,
        name: debuffDef.name,
        description: debuffDef.description,
        remainingTurns: debuffDef.duration,
        modifiers: { ...debuffDef.modifiers }
      };
      if (existingIdx >= 0) {
        activeOpponentCreature.activeDebuffs[existingIdx] = debuffInstance;
      } else {
        activeOpponentCreature.activeDebuffs.push(debuffInstance);
      }

      activeActorCreature.cooldowns.debuff = debuffDef.cooldown;
      usedCooldownKey = 'debuff';

      logs.push(`${activeActorCreature.name} aplicou ${debuffDef.name} em ${activeOpponentCreature.name}!`);
      animation = {
        category: 'debuff',
        style: debuffDef.animation.style,
        color: debuffDef.animation.color,
        particleColor: debuffDef.animation.particleColor,
        casterId: playerId,
        targetId: opponentId,
        label: debuffDef.name
      };
      break;
    }

    case 'protect': {
      const protectDef = gameData.protectConfig;
      if (activeActorCreature.cooldowns.protect > 0) {
        throw new CombatError(
          'ON_COOLDOWN',
          `Proteger está em recarga por mais ${activeActorCreature.cooldowns.protect} turno(s).`
        );
      }

      activeActorCreature.protected = true;
      activeActorCreature.cooldowns.protect = protectDef.cooldown;
      usedCooldownKey = 'protect';

      logs.push(`${activeActorCreature.name} ergueu um escudo protetor!`);
      animation = {
        category: 'protect',
        style: protectDef.animation.style,
        color: protectDef.animation.color,
        particleColor: protectDef.animation.particleColor,
        casterId: playerId,
        targetId: playerId,
        label: 'ESCUDO!'
      };
      break;
    }

    case 'item': {
      const itemId = payload.itemId;
      const item = gameData.itemsById[itemId];
      if (!item) {
        throw new CombatError('ITEM_NOT_FOUND', `Item "${itemId}" não existe.`);
      }

      const remaining = actor.inventory[itemId] ?? 0;
      if (remaining <= 0) {
        throw new CombatError('ITEM_DEPLETED', `${item.name} está esgotado!`);
      }

      actor.inventory[itemId] = remaining - 1;

      if (item.kind === 'heal') {
        const healed = Math.min(activeActorCreature.maxHp - activeActorCreature.hp, item.healAmount);
        activeActorCreature.hp += healed;
        logs.push(`${actor.nickname} usou ${item.name} em ${activeActorCreature.name} (+${healed} HP).`);
        animation = {
          category: 'item_heal',
          style: item.animation.style,
          color: item.animation.color,
          particleColor: item.animation.particleColor,
          casterId: playerId,
          targetId: playerId,
          healAmount: healed,
          label: `+${healed} HP`
        };
      } else if (item.kind === 'cleanse') {
        const removedCount = activeActorCreature.activeDebuffs.length;
        activeActorCreature.activeDebuffs = [];
        let healed = 0;
        if (item.healAmount > 0) {
          healed = Math.min(activeActorCreature.maxHp - activeActorCreature.hp, item.healAmount);
          activeActorCreature.hp += healed;
        }
        if (item.bonusBuff) {
          activeActorCreature.activeBuff = {
            id: item.bonusBuff.id,
            name: item.bonusBuff.name,
            description: item.description,
            remainingTurns: item.bonusBuff.duration,
            modifiers: { ...item.bonusBuff.modifiers }
          };
          justAppliedBuff = true;
        }

        const parts = [`${actor.nickname} usou ${item.name} em ${activeActorCreature.name}`];
        if (removedCount > 0) parts.push(`removeu ${removedCount} debuff(s)`);
        if (healed > 0) parts.push(`curou ${healed} HP`);
        if (item.bonusBuff) parts.push(`ativou ${item.bonusBuff.name}`);
        logs.push(`${parts.join(', ')}.`);

        animation = {
          category: 'item_cleanse',
          style: item.animation.style,
          color: item.animation.color,
          particleColor: item.animation.particleColor,
          casterId: playerId,
          targetId: playerId,
          healAmount: healed,
          label: 'PURIFICADO!'
        };
      } else {
        throw new CombatError('INVALID_ITEM_KIND', 'Tipo de item não suportado.');
      }
      break;
    }

    default:
      throw new CombatError('INVALID_ACTION_TYPE', `Ação "${payload.type}" não reconhecida.`);
  }

  // End-of-turn cooldown & DoT/HoT tick for the acting player's active creature
  let tickEvents = [];
  if (activeOpponentCreature.hp > 0 && activeActorCreature.hp > 0) {
    const tickRes = tickCooldownsAndEffectsAtTurnEnd(activeActorCreature, playerId, usedCooldownKey, justAppliedBuff, gameData);
    logs.push(...tickRes.logs);
    tickEvents = tickRes.tickEvents;
  }

  // Check for faints and replacements
  let winnerId = null;
  let endReason = null;

  // Handle opponent faint
  if (activeOpponentCreature.hp <= 0) {
    activeOpponentCreature.hp = 0;
    activeOpponentCreature.fainted = true;
    activeOpponentCreature.activeBuff = null;
    activeOpponentCreature.activeDebuffs = [];
    logs.push(`${activeOpponentCreature.name} de ${opponent.nickname} desmaiou!`);

    if (!hasAliveCreatures(opponent)) {
      winnerId = playerId;
      endReason = 'knockout';
      logs.push(`Todas as criaturas de ${opponent.nickname} foram derrotadas! ${actor.nickname} venceu a batalha!`);
    } else {
      const nextIdx = getNextAliveCreatureIndex(opponent);
      opponent.activeCreatureIndex = nextIdx;
      const nextCreature = opponent.team[nextIdx];
      logs.push(`${opponent.nickname} enviou ${nextCreature.name} para o combate!`);
      replacement = {
        playerId: opponentId,
        newCreatureId: nextCreature.creatureId,
        newCreatureName: nextCreature.name,
        targetIndex: nextIdx
      };
    }
  }

  // Handle actor faint (from DoT or recoil if any)
  if (activeActorCreature.hp <= 0 && !winnerId) {
    activeActorCreature.hp = 0;
    activeActorCreature.fainted = true;
    activeActorCreature.activeBuff = null;
    activeActorCreature.activeDebuffs = [];
    logs.push(`${activeActorCreature.name} de ${actor.nickname} desmaiou!`);

    if (!hasAliveCreatures(actor)) {
      winnerId = opponentId;
      endReason = 'knockout';
      logs.push(`Todas as criaturas de ${actor.nickname} foram derrotadas! ${opponent.nickname} venceu a batalha!`);
    } else {
      const nextIdx = getNextAliveCreatureIndex(actor);
      actor.activeCreatureIndex = nextIdx;
      const nextCreature = actor.team[nextIdx];
      logs.push(`${actor.nickname} enviou ${nextCreature.name} para o combate!`);
      replacement = {
        playerId: playerId,
        newCreatureId: nextCreature.creatureId,
        newCreatureName: nextCreature.name,
        targetIndex: nextIdx
      };
    }
  }

  // Synchronize mirrored properties on both participants
  syncActiveCreatureMirror(actor);
  syncActiveCreatureMirror(opponent);

  const completedTurn = battle.turnNumber;

  if (winnerId) {
    match.phase = 'finished';
    match.winnerId = winnerId;
    match.endReason = endReason;
  } else {
    battle.turnNumber += 1;
    battle.currentTurnPlayerId = opponentId;
  }

  battle.log.push(...logs);
  if (battle.log.length > 40) {
    battle.log = battle.log.slice(-40);
  }

  return {
    turnNumber: completedTurn,
    actorId: playerId,
    targetId: opponentId,
    actionType: payload.type,
    logs,
    tickEvents,
    animation,
    replacement,
    winnerId,
    endReason
  };
}

module.exports = {
  CombatError,
  createParticipantState,
  computeEffectiveStats,
  executeTurnAction,
  hasAliveCreatures
};
