/**
 * Merges frontend/.env EXPO_PUBLIC_* into eas.json build profiles (preview + production).
 * Does not print secret values. Run: node scripts/sync-eas-preview-env.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
const easPath = path.join(root, 'eas.json');

const KEYS = [
  'EXPO_PUBLIC_BACKEND_URL',
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY',
];

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

if (!fs.existsSync(envPath)) {
  console.error('Missing frontend/.env — copy from .env.example and fill values.');
  process.exit(1);
}

const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
const env = parseEnv(stripBom(fs.readFileSync(envPath, 'utf8')));
const eas = JSON.parse(stripBom(fs.readFileSync(easPath, 'utf8')));
eas.build = eas.build || {};
const profiles = ['preview', 'preview-apk', 'preview-apk-live', 'production'].filter((p) => eas.build[p]);
if (!profiles.includes('preview')) {
  eas.build.preview = { env: {} };
  profiles.push('preview');
}
if (!profiles.includes('production')) {
  eas.build.production = { env: {} };
  profiles.push('production');
}

let ok = 0;
for (const profile of profiles) {
  eas.build[profile].env = eas.build[profile].env || {};
  for (const k of KEYS) {
    if (env[k]) {
      eas.build[profile].env[k] = env[k];
      if (profile === 'production') ok += 1;
      console.log(`[${profile}] set ${k} (len=${env[k].length})`);
    } else if (profile === 'production') {
      console.log(`missing ${k}`);
    }
  }
}

fs.writeFileSync(easPath, JSON.stringify(eas, null, 2) + '\n', 'utf8');
console.log(`Synced ${ok}/${KEYS.length} keys into eas.json (${profiles.join(', ')})`);
console.log('WARNING: EXPO_PUBLIC_BACKEND_URL must be a public HTTPS URL for store / remote users.');
