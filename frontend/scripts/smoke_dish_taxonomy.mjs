/**
 * Smoke taksonomii — synonimy / forbidden / placeholdery.
 * node frontend/scripts/smoke_dish_taxonomy.mjs
 *
 * Inline port kluczowych funkcji z dishTaxonomy.ts (bez tsx).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(__dirname, '..');

function normalizeDishName(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/ą/g, 'a')
    .replace(/ę/g, 'e')
    .replace(/ó/g, 'o')
    .replace(/ń/g, 'n')
    .replace(/ś/g, 's')
    .replace(/ć/g, 'c')
    .replace(/ź|ż/g, 'z')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const RULES = [
  { re: /\b(focaccia)\b/, family: 'focaccia' },
  { re: /\bpizza\b/, family: 'pizza' },
  { re: /\b(pierog\w*|uszka|pielmieni|wareniki)\b/, family: 'pierogi' },
  { re: /\b(kopytk\w*|kluski\w*|leniwe|pampuch\w*|pyzy|kartacz\w*|cepelin\w*|buchty)\b/, family: 'kluski' },
  { re: /\b(placki ziemniacz\w*|racuch\w*)\b/, family: 'placki' },
  { re: /\b(burger|cheeseburger|hamburger)\b/, family: 'burger' },
  { re: /\b(tomahawk|t.?bone|ribeye|rib eye|antrykot|stek)\b/, family: 'steak' },
  { re: /\b(kebab|doner|shawarma|gyro|shish|adana|kofta)\b/, family: 'kebab' },
  { re: /\b(hosomaki|futomaki|uramaki|california|philadelphia|dragon roll|spicy tuna|tempura roll|maki|sushi|nigiri|sashimi)\b/, family: 'sushi' },
  { re: /\b(butter chicken|tikka|curry)\b/, family: 'indian' },
];

const FORBIDDEN = [
  ['pizza', 'focaccia'],
  ['pierogi', 'kluski'],
  ['pierogi', 'placki'],
  ['kluski', 'placki'],
  ['burger', 'steak'],
];

const PLACEHOLDERS = {
  pizza: ['pizza_margherita', 'pizza_pepperoni', 'pizza_hawajska'],
  focaccia: ['veggie_focaccia', 'focaccia_pizza'],
  pierogi: ['pierogi_ruskie', 'pierogi_z_miesem', 'pierogi_kapusta_grzyby'],
  kluski: ['kopytka', 'kluski_slaskie', 'kluski_leniwe'],
  burger: ['classic_cheeseburger', 'burger_bbq_board'],
  steak: ['stek_ribeye', 'stek_tbone', 'stek_tomahawk'],
  kebab: ['kebab_rollo', 'kebab_talerz', 'szawarma_kurczak', 'gyros_talerz'],
  sushi: ['california_roll', 'sake_nigiri', 'futomaki_losos'],
  indian: ['butter_chicken', 'chicken_tikka_masala', 'naan'],
};

function detectFamily(name) {
  const n = normalizeDishName(name);
  for (const r of RULES) if (r.re.test(n)) return r.family;
  return 'other';
}

function familiesForbidden(a, b) {
  if (a === 'other' || b === 'other' || a === b) return false;
  return FORBIDDEN.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

function imageConflicts(queryFamily, blob) {
  const n = normalizeDishName(blob);
  let img = 'other';
  if (/\bfocaccia\b/.test(n)) img = 'focaccia';
  else if (/\bpizza|calzone\b/.test(n)) img = 'pizza';
  else if (/\bpierog|uszka\b/.test(n)) img = 'pierogi';
  else if (/\bkopytk|kluski|leniwe|pampuch|kartacz|cepelin\b/.test(n)) img = 'kluski';
  else if (/\bburger|slider\b/.test(n)) img = 'burger';
  else if (/\bstek|ribeye|tomahawk|t.?bone\b/.test(n)) img = 'steak';
  return familiesForbidden(queryFamily, img);
}

const libPath = path.join(FRONTEND, 'assets/premium/imageLibrary.json');
const lib = JSON.parse(fs.readFileSync(libPath, 'utf8'));
const entries = Array.isArray(lib) ? lib : lib.entries || lib.images || [];
const slugs = new Set(entries.map((e) => e?.slug).filter(Boolean));

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed += 1;
  } else {
    console.log('OK  ', msg);
  }
}

const familyCases = [
  ['Pizza Margherita', 'pizza'],
  ['Focaccia z rozmarynem', 'focaccia'],
  ['Pierogi ruskie', 'pierogi'],
  ['Kluski śląskie', 'kluski'],
  ['Kopytka z masłem', 'kluski'],
  ['Placki ziemniaczane', 'placki'],
  ['Classic cheeseburger', 'burger'],
  ['Stek ribeye', 'steak'],
  ['Kebab na talerzu', 'kebab'],
  ['California roll', 'sushi'],
  ['Butter chicken', 'indian'],
];

for (const [name, want] of familyCases) {
  assert(detectFamily(name) === want, `family("${name}") === ${want} (got ${detectFamily(name)})`);
}

assert(familiesForbidden('pizza', 'focaccia'), 'pizza ≠ focaccia');
assert(familiesForbidden('pierogi', 'kluski'), 'pierogi ≠ kluski');
assert(familiesForbidden('burger', 'steak'), 'burger ≠ steak');
assert(!familiesForbidden('pizza', 'pizza'), 'pizza == pizza ok');

assert(imageConflicts('pizza', 'veggie_focaccia focaccia bread'), 'pizza query blocks focaccia image');
assert(imageConflicts('pierogi', 'kluski_slaskie kopytka'), 'pierogi query blocks kluski image');
assert(imageConflicts('steak', 'classic_cheeseburger burger'), 'steak query blocks burger image');
assert(!imageConflicts('pierogi', 'pierogi_ruskie pierogi'), 'pierogi query allows pierogi image');

for (const [fam, list] of Object.entries(PLACEHOLDERS)) {
  const hit = list.find((s) => slugs.has(s));
  assert(!!hit, `placeholder for ${fam} exists (tried ${list.join(', ')})`);
}

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll taxonomy smoke checks passed.');
