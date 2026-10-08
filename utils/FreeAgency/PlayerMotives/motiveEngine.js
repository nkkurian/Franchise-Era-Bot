'use strict';

const ARCHETYPES = Object.freeze({
  'Franchise Player': {
    money: 3, winning: 4, role: 4,
    security: 4, loyalty: 5, ego: 3
  },
  Mercenary: {
    money: 5, winning: 2, role: 3,
    security: 2, loyalty: 1, ego: 4
  },
  Competitor: {
    money: 3, winning: 5, role: 3,
    security: 2, loyalty: 3, ego: 3
  },
  'Featured Star': {
    money: 4, winning: 3, role: 5,
    security: 2, loyalty: 2, ego: 5
  },
  'Security Seeker': {
    money: 3, winning: 3, role: 3,
    security: 5, loyalty: 4, ego: 2
  },
  'Bet-on-Myself': {
    money: 4, winning: 3, role: 5,
    security: 1, loyalty: 2, ego: 4
  },
  Professional: {
    money: 3, winning: 3, role: 3,
    security: 4, loyalty: 3, ego: 2
  },
  'Legacy Chaser': {
    money: 2, winning: 5, role: 3,
    security: 2, loyalty: 4, ego: 3
  },
  'Fresh Start': {
    money: 3, winning: 3, role: 5,
    security: 2, loyalty: 1, ego: 3
  },
  'Wild Card': {
    money: 3, winning: 3, role: 3,
    security: 3, loyalty: 3, ego: 3
  }
});

const MOTIVES = Object.freeze([
  'money',
  'winning',
  'role',
  'security',
  'loyalty',
  'ego'
]);

const GENERATION_VERSION = 1;

function hashString(input) {
  let hash = 2166136261;

  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function seededRandom(seed) {
  let state = seed >>> 0;

  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;

    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value) {
  return Math.max(1, Math.min(5, Math.round(value)));
}

function pickArchetype(random, age, position) {
  const weights = Object.keys(ARCHETYPES).map((name) => {
    let weight = 1;

    if (age !== null && age >= 30 && name === 'Legacy Chaser') {
      weight += 1.5;
    }

    if (age !== null && age <= 25 && name === 'Bet-on-Myself') {
      weight += 1.2;
    }

    if (age !== null && age >= 28 && name === 'Security Seeker') {
      weight += 0.7;
    }

    if (
      ['QB', 'RB', 'WR', 'TE'].includes(position) &&
      name === 'Featured Star'
    ) {
      weight += 0.3;
    }

    return { name, weight };
  });

  let ticket = random() * weights.reduce(
    (sum, item) => sum + item.weight,
    0
  );

  for (const item of weights) {
    ticket -= item.weight;

    if (ticket < 0) {
      return item.name;
    }
  }

  return weights[weights.length - 1].name;
}

/**
 * Generates a deterministic player personality.
 *
 * Does not connect to Supabase or Google Sheets.
 * Does not modify player contracts.
 *
 * Once a personality is saved to Supabase,
 * retrieve that saved profile instead of regenerating it.
 */
function generatePlayerMotives({
  leagueId,
  sleeperId,
  age = null,
  position = ''
}) {
  if (!String(leagueId ?? '').trim()) {
    throw new Error('leagueId is required');
  }

  if (!String(sleeperId ?? '').trim()) {
    throw new Error('sleeperId is required');
  }

  const numericAge =
    age === null || age === undefined || age === ''
      ? null
      : Number(age);

  if (
    numericAge !== null &&
    (
      !Number.isFinite(numericAge) ||
      numericAge < 16 ||
      numericAge > 60
    )
  ) {
    throw new Error('age must be a reasonable number or null');
  }

  const normalizedPosition = String(position || '')
    .trim()
    .toUpperCase();

  const seed = hashString(
    `${GENERATION_VERSION}:${String(leagueId)}:${String(sleeperId)}`
  );

  const random = seededRandom(seed);

  const archetype = pickArchetype(
    random,
    numericAge,
    normalizedPosition
  );

  const baseline = ARCHETYPES[archetype];
  const motives = {};

  for (const motive of MOTIVES) {
    // Individual variation around archetype preferences.
    const variation =
      random() < 0.18
        ? (random() < 0.5 ? -2 : 2)
        : (random() < 0.5 ? -1 : 1);

    const unchanged = random() < 0.28;

    motives[motive] = clamp(
      baseline[motive] + (unchanged ? 0 : variation)
    );
  }

  // Career-stage influences.
  if (numericAge !== null) {
    if (numericAge >= 30) {
      if (random() < 0.55) {
        motives.winning = clamp(motives.winning + 1);
      }

      if (random() < 0.45) {
        motives.security = clamp(motives.security + 1);
      }
    } else if (numericAge <= 25) {
      if (random() < 0.5) {
        motives.role = clamp(motives.role + 1);
      }
    }
  }

  return Object.freeze({
    leagueId: String(leagueId),
    sleeperId: String(sleeperId),
    archetype,
    ...motives,
    generationVersion: GENERATION_VERSION
  });
}

module.exports = {
  generatePlayerMotives,
  ARCHETYPES,
  GENERATION_VERSION
};