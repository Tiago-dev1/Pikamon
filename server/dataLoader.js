const fs = require('fs');
const path = require('path');

/**
 * Reads and parses a JSON file from the data directory.
 * @param {string} filename
 * @returns {any}
 */
function readJsonFile(filename) {
  const fullPath = path.join(__dirname, '..', 'data', filename);
  const raw = fs.readFileSync(fullPath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Loads all game definitions (types, moves, creatures, items) from JSON files
 * and validates referential integrity across them.
 */
function loadGameData() {
  const typesJson = readJsonFile('types.json');
  const movesJson = readJsonFile('moves.json');
  const creaturesJson = readJsonFile('creatures.json');
  const itemsJson = readJsonFile('items.json');

  const typesById = typesJson.types || {};
  const movesById = movesJson.moves || {};
  const protectConfig = movesJson.protect;
  const creaturesList = creaturesJson.creatures || [];
  const itemsList = itemsJson.items || [];

  if (!protectConfig) {
    throw new Error('Missing protect configuration in data/moves.json');
  }

  const creaturesById = {};
  for (const creature of creaturesList) {
    if (!Array.isArray(creature.types) || creature.types.length === 0) {
      creature.types = [creature.type || 'fogo'];
    }
    for (const t of creature.types) {
      if (!typesById[t]) {
        throw new Error(`Creature "${creature.id}" references unknown type "${t}"`);
      }
    }
    creature.type = creature.types[0];

    if (!movesById[creature.signatureMoveId]) {
      throw new Error(`Creature "${creature.id}" references unknown signatureMoveId "${creature.signatureMoveId}"`);
    }
    if (!movesById[creature.weakMoveId]) {
      throw new Error(`Creature "${creature.id}" references unknown weakMoveId "${creature.weakMoveId}"`);
    }
    creaturesById[creature.id] = creature;
  }

  for (const typeDef of Object.values(typesById)) {
    if (!movesById[typeDef.weakMoveId]) {
      throw new Error(`Type "${typeDef.id}" references unknown weakMoveId "${typeDef.weakMoveId}"`);
    }
  }

  const itemsById = {};
  for (const item of itemsList) {
    itemsById[item.id] = item;
  }

  return {
    typesById,
    movesById,
    protectConfig,
    creaturesList,
    creaturesById,
    itemsList,
    itemsById,
    getCatalog() {
      return {
        types: typesById,
        moves: movesById,
        protect: protectConfig,
        creatures: creaturesList,
        items: itemsList
      };
    }
  };
}

module.exports = { loadGameData };

