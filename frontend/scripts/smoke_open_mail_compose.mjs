/**
 * Smoke: domena From → dostawca poczty + ścieżka prefill (web vs mailto).
 * op.pl = Onet (nie Orange). Portale PL bez compose URL → mailto.
 */
import assert from 'node:assert/strict';

const MAIL_PROVIDERS = [
  { id: 'gmail', domains: ['gmail.com', 'googlemail.com'], webCompose: true },
  { id: 'yahoo', domains: ['yahoo.com', 'yahoo.pl', 'ymail.com'], webCompose: true },
  { id: 'outlook', domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'], webCompose: true },
  { id: 'wp', domains: ['wp.pl'], webCompose: false },
  { id: 'onet', domains: ['onet.pl', 'op.pl', 'poczta.onet.pl'], webCompose: false },
  { id: 'o2', domains: ['o2.pl', 'go2.pl', 'tlen.pl'], webCompose: false },
  { id: 'interia', domains: ['interia.pl', 'interia.eu', 'poczta.fm'], webCompose: false },
  { id: 'orange', domains: ['orange.pl', 'orange.com'], webCompose: false },
];

function domainOf(email) {
  const at = email.trim().toLowerCase().lastIndexOf('@');
  if (at < 0) return '';
  return email.trim().toLowerCase().slice(at + 1);
}

function findProvider(fromEmail) {
  const d = domainOf(fromEmail);
  for (const p of MAIL_PROVIDERS) {
    if (p.domains.some((dom) => d === dom || d.endsWith(`.${dom}`))) return p;
  }
  return null;
}

function prefillMode(fromEmail) {
  const p = findProvider(fromEmail);
  if (p?.webCompose) return 'web';
  return 'mailto'; // uniwersalny szkic: to + temat + treść
}

assert.equal(findProvider('ja@gmail.com')?.id, 'gmail');
assert.equal(findProvider('x@yahoo.pl')?.id, 'yahoo');
assert.equal(findProvider('x@hotmail.com')?.id, 'outlook');
assert.equal(findProvider('ja@o2.pl')?.id, 'o2');
assert.equal(findProvider('ja@op.pl')?.id, 'onet');
assert.equal(findProvider('ja@onet.pl')?.id, 'onet');
assert.equal(findProvider('x@orange.pl')?.id, 'orange');
assert.equal(findProvider('szef@firma.pl'), null);
assert.equal(prefillMode('ja@op.pl'), 'mailto');
assert.equal(prefillMode('ja@wp.pl'), 'mailto');
assert.equal(prefillMode('ja@gmail.com'), 'web');
assert.equal(prefillMode('ja@outlook.com'), 'web');
assert.equal(prefillMode('szef@firma.pl'), 'mailto');
console.log('smoke_open_mail_compose: ok');
