import { normalizeTags } from '../js/state.js';

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

assertEqual(normalizeTags(undefined), [], 'Missing tags become an empty list');
assertEqual(
  normalizeTags([undefined, null, ' работа ', '', 'работа', 42]),
  ['работа', '42'],
  'Invalid values are removed and valid tags are normalized',
);
assertEqual(normalizeTags('дом'), ['дом'], 'Legacy single tags are preserved');

console.log('State normalization test passed.');
