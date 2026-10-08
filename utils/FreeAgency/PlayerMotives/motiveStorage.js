'use strict';

const { generatePlayerMotives } = require('./motiveEngine');

const TAB_NAME = 'Player_Motives';

const HEADERS = [
  'League_ID',
  'Sleeper_ID',
  'Archetype',
  'Money',
  'Winning',
  'Role',
  'Security',
  'Loyalty',
  'Ego',
  'Generation_Version',
  'Last_Evolved_Season'
];

const MOTIVE_COLUMNS = {
  money: 'Money',
  winning: 'Winning',
  role: 'Role',
  security: 'Security',
  loyalty: 'Loyalty',
  ego: 'Ego'
};

// Prevent duplicate creation within one running bot process.
const pendingProfiles = new Map();

function validateSheet(sheet) {
  if (!sheet) {
    throw new Error(
      `Missing ${TAB_NAME} tab. Ask the bot owner to create it.`
    );
  }

  const actual = sheet.headerValues || [];

  if (
    HEADERS.length !== actual.length ||
    HEADERS.some((header, i) => header !== actual[i])
  ) {
    throw new Error(
      `${TAB_NAME} has unexpected headers. Check columns A:K.`
    );
  }
}

function readProfile(row) {
  const profile = {
    leagueId: String(row.get('League_ID')),
    sleeperId: String(row.get('Sleeper_ID')),
    archetype: String(row.get('Archetype')),
    generationVersion: Number(row.get('Generation_Version')),
    lastEvolvedSeason: row.get('Last_Evolved_Season')
      ? Number(row.get('Last_Evolved_Season'))
      : null
  };

  for (const [key, column] of Object.entries(MOTIVE_COLUMNS)) {
    const value = Number(row.get(column));

    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw new Error(
        `Invalid ${column} value for player ${profile.sleeperId}`
      );
    }

    profile[key] = value;
  }

  return profile;
}

async function findPlayerMotives(doc, leagueId, sleeperId) {
  const sheet = doc.sheetsByTitle[TAB_NAME];
  validateSheet(sheet);

  const rows = await sheet.getRows();

  const matches = rows.filter(row =>
    String(row.get('League_ID')) === String(leagueId) &&
    String(row.get('Sleeper_ID')) === String(sleeperId)
  );

  if (matches.length > 1) {
    throw new Error(
      `Duplicate motive profiles for Sleeper ID ${sleeperId}`
    );
  }

  return matches.length ? readProfile(matches[0]) : null;
}

async function getOrCreatePlayerMotives(doc, player) {
  const leagueId = String(player.leagueId || '').trim();
  const sleeperId = String(player.sleeperId || '').trim();

  if (!leagueId || !sleeperId) {
    throw new Error('leagueId and sleeperId are required');
  }

  const key = `${leagueId}:${sleeperId}`;

  if (pendingProfiles.has(key)) {
    return pendingProfiles.get(key);
  }

  const task = (async () => {
    const existing = await findPlayerMotives(
      doc,
      leagueId,
      sleeperId
    );

    if (existing) return existing;

    const generated = generatePlayerMotives({
      leagueId,
      sleeperId,
      age: player.age ?? null,
      position: player.position || ''
    });

    const sheet = doc.sheetsByTitle[TAB_NAME];

    await sheet.addRow({
      League_ID: generated.leagueId,
      Sleeper_ID: generated.sleeperId,
      Archetype: generated.archetype,
      Money: generated.money,
      Winning: generated.winning,
      Role: generated.role,
      Security: generated.security,
      Loyalty: generated.loyalty,
      Ego: generated.ego,
      Generation_Version: generated.generationVersion,
      Last_Evolved_Season: ''
    });

    return {
      ...generated,
      lastEvolvedSeason: null
    };
  })();

  pendingProfiles.set(key, task);

  try {
    return await task;
  } finally {
    pendingProfiles.delete(key);
  }
}

module.exports = {
  TAB_NAME,
  HEADERS,
  findPlayerMotives,
  getOrCreatePlayerMotives
};