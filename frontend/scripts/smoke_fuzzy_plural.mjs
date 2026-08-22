/**
 * Smoke: bataty↔batat, marchewka↔marchew (stem + synonimy jak w fuzzyProductMatch).
 */
import assert from 'node:assert/strict';

const SYNONYM = {
  marchewki: 'marchew',
  marchewek: 'marchew',
  marchewka: 'marchew',
  marchewke: 'marchew',
  marchew: 'marchew',
  bataty: 'batat',
  batatow: 'batat',
  batata: 'batat',
  batatem: 'batat',
  batat: 'batat',
};

function lightStem(token) {
  if (SYNONYM[token]) return SYNONYM[token];
  const suffixes = ['ami', 'ach', 'owi', 'iem', 'ow', 'om', 'em', 'ie'];
  for (const suf of suffixes) {
    if (token.length > suf.length + 3 && token.endsWith(suf)) {
      const stem = token.slice(0, -suf.length);
      return SYNONYM[stem] ?? stem;
    }
  }
  if (token.length >= 5 && /[ayiue]$/.test(token)) {
    const stem = token.slice(0, -1);
    if (stem.length >= 4) return SYNONYM[stem] ?? stem;
  }
  return token;
}

function key(s) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .split(/\s+/)
    .filter(Boolean)
    .map(lightStem)
    .sort()
    .join(' ');
}

assert.equal(key('bataty'), key('batat'));
assert.equal(key('Bataty'), key('batat'));
assert.equal(key('marchewka'), key('marchew'));
assert.equal(key('marchewki'), key('Marchew'));
assert.notEqual(key('bataty'), key('marchew'));
console.log('smoke_fuzzy_plural: ok');
