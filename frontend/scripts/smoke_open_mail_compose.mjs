/**
 * Smoke: domena From → dostawca poczty (bez Linking).
 */
import assert from 'node:assert/strict';

const MAIL_PROVIDERS = [
  { id: 'gmail', domains: ['gmail.com', 'googlemail.com'] },
  { id: 'yahoo', domains: ['yahoo.com', 'yahoo.pl'] },
  { id: 'outlook', domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'] },
  { id: 'wp', domains: ['wp.pl'] },
  { id: 'o2', domains: ['o2.pl'] },
  { id: 'op', domains: ['op.pl', 'orange.pl'] },
];

function domainOf(email) {
  const at = email.trim().toLowerCase().lastIndexOf('@');
  if (at < 0) return '';
  return email.trim().toLowerCase().slice(at + 1);
}

function findId(fromEmail) {
  const d = domainOf(fromEmail);
  for (const p of MAIL_PROVIDERS) {
    if (p.domains.some((dom) => d === dom || d.endsWith(`.${dom}`))) return p.id;
  }
  return 'unknown';
}

assert.equal(findId('ja@gmail.com'), 'gmail');
assert.equal(findId('x@yahoo.pl'), 'yahoo');
assert.equal(findId('x@hotmail.com'), 'outlook');
assert.equal(findId('ja@o2.pl'), 'o2');
assert.equal(findId('ja@op.pl'), 'op');
assert.equal(findId('szef@firma.pl'), 'unknown');
console.log('smoke_open_mail_compose: ok');
