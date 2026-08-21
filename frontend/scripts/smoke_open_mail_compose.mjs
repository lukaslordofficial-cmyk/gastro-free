/**
 * Smoke: domena From → URL compose (bez Linking).
 * node --experimental-vm-modules / zwykły node z dynamic import nie potrzebny —
 * kopiujemy logikę domeny przez require transpiled? Użyj prostego asercji przez ts-node?
 * Tutaj: mały test w JS mirror — lepiej w backendzie nie. FE smoke mjs:
 */
import assert from 'node:assert/strict';

function domainOf(email) {
  const at = email.trim().toLowerCase().lastIndexOf('@');
  if (at < 0) return '';
  return email.trim().toLowerCase().slice(at + 1);
}

function composeKind(fromEmail) {
  const d = domainOf(fromEmail);
  if (d === 'gmail.com' || d === 'googlemail.com') return 'gmail';
  if (d.includes('yahoo')) return 'yahoo';
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(d)) return 'outlook';
  return 'mailto';
}

assert.equal(composeKind('ja@gmail.com'), 'gmail');
assert.equal(composeKind('x@yahoo.pl'), 'yahoo');
assert.equal(composeKind('x@hotmail.com'), 'outlook');
assert.equal(composeKind('szef@firma.pl'), 'mailto');
console.log('smoke_open_mail_compose: ok');
