/**
 * Smoke: domena From → dostawca poczty (bez Linking).
 * op.pl = Onet (nie Orange).
 */
import assert from 'node:assert/strict';

const MAIL_PROVIDERS = [
  { id: 'gmail', domains: ['gmail.com', 'googlemail.com'] },
  { id: 'yahoo', domains: ['yahoo.com', 'yahoo.pl', 'ymail.com'] },
  { id: 'outlook', domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'] },
  { id: 'wp', domains: ['wp.pl'] },
  { id: 'onet', domains: ['onet.pl', 'op.pl', 'poczta.onet.pl'] },
  { id: 'o2', domains: ['o2.pl', 'go2.pl', 'tlen.pl'] },
  { id: 'interia', domains: ['interia.pl', 'interia.eu', 'poczta.fm'] },
  { id: 'orange', domains: ['orange.pl', 'orange.com'] },
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
assert.equal(findId('ja@op.pl'), 'onet');
assert.equal(findId('ja@onet.pl'), 'onet');
assert.equal(findId('x@orange.pl'), 'orange');
assert.equal(findId('szef@firma.pl'), 'unknown');
console.log('smoke_open_mail_compose: ok');
