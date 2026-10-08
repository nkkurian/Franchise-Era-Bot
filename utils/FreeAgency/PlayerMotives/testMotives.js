const assert = require('node:assert/strict');

const {
  generatePlayerMotives,
  ARCHETYPES
} = require('./motiveEngine');

// Test player using Sleeper ID 96.
const input = {
  leagueId: '1353482184714895360',
  sleeperId: '96',
  age: 42,
  position: 'QB'
};

// Generate the personality twice.
const first = generatePlayerMotives(input);
const second = generatePlayerMotives(input);

// Verify that the same input produces the same personality.
assert.deepEqual(
  first,
  second,
  'Same input must give same personality'
);

// Verify the archetype exists.
assert.ok(Object.hasOwn(ARCHETYPES, first.archetype));

// Verify that all six motives are between 1 and 5.
for (const key of [
  'money',
  'winning',
  'role',
  'security',
  'loyalty',
  'ego'
]) {
  assert.ok(
    Number.isInteger(first[key]) &&
    first[key] >= 1 &&
    first[key] <= 5
  );
}

// Different players should generally have different profiles.
assert.notDeepEqual(
  first,
  generatePlayerMotives({
    ...input,
    sleeperId: '167'
  })
);

// Missing league ID should cause an error.
assert.throws(() =>
  generatePlayerMotives({
    sleeperId: '96'
  })
);

console.log('All motive generation tests passed.');
console.log(first);