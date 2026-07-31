#!/usr/bin/env node
/**
 * Generuje frontend/assets/premium/imageLibrary.json dla wszystkich grafik dań.
 *
 * Użycie:
 *   node frontend/scripts/generate_image_library.mjs
 *   OPENAI_API_KEY=sk-... node frontend/scripts/generate_image_library.mjs --enrich
 *
 * Pass 1 (zawsze): heurystyki PL z nazwy pliku + metadane z *Catalog.ts
 * Pass 2 (opcjonalnie --enrich): OpenAI batch gdy OPENAI_API_KEY jest ustawiony
 *
 * Wyklucza packaging / warehouse placeholders. Nie rusza Deal Hunter.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(__dirname, '..');
const DISHES_DIR = path.join(FRONTEND, 'assets', 'premium', 'dishes');
const LIB_DIR = path.join(FRONTEND, 'lib');
const OUT_PATH = path.join(FRONTEND, 'assets', 'premium', 'imageLibrary.json');

const IMAGE_EXT = new Set(['.webp', '.jpg', '.jpeg', '.png']);
const EXCLUDE_PATH_RE = /(?:^|[/\\])(?:packaging|opakowania|placeholders|warehouse)(?:[/\\]|$)/i;

const FOLDER_CATEGORY = {
  apps: 'Przystawki',
  asian: 'Danie główne / Azja',
  bbq: 'Danie główne / BBQ',
  beers: 'Napoje / Piwo',
  breakfast: 'Śniadania',
  burgers: 'Burgery',
  cakes: 'Desery / Ciasta',
  catering: 'Catering',
  caucasian: 'Danie główne / Kaukaska',
  cocktails: 'Napoje / Koktajle',
  coffees: 'Napoje / Kawa',
  desserts_cups: 'Desery',
  dinners: 'Danie główne',
  dumplings: 'Pierogi / Knedle',
  energy_drinks: 'Napoje / Energetyki',
  fish: 'Danie główne / Ryby',
  french_desserts: 'Desery / Francuskie',
  ice_cream: 'Desery / Lody',
  indian: 'Danie główne / Indyjska',
  juices: 'Napoje / Soki',
  kebabs: 'Kebab',
  lemonades: 'Napoje / Lemoniady',
  mediterranean: 'Danie główne / Śródziemnomorska',
  mexican: 'Danie główne / Meksykańska',
  pancakes: 'Desery / Naleśniki',
  pastas: 'Makarony',
  pastries: 'Desery / Wypieki',
  pizzas: 'Pizza',
  polish: 'Danie główne / Polska',
  roasts: 'Danie główne / Pieczenie',
  salads: 'Sałatki',
  sauces: 'Sosy',
  sides: 'Dodatki',
  soups_asia: 'Zupy / Azja',
  soups_pl: 'Zupy',
  soups_polish: 'Zupy / Polska',
  spirits: 'Napoje / Alkohole',
  starters: 'Przystawki',
  street: 'Street food',
  sushi: 'Sushi',
  teas: 'Napoje / Herbata',
  vegan: 'Wege',
  wines: 'Napoje / Wino',
};

/** Słowa kluczowe → tagi (normalizowane bez diakrytyków). */
const KEYWORD_TAGS = [
  { re: /\bkaczk/, tags: ['kaczka', 'drób', 'mięso pieczone', 'ptactwo'], forbid: ['wege', 'ryba', 'wołowina', 'deser'] },
  { re: /\b(kurczak|chicken|nugget|de.?volaille|piers.?z.?kur)/, tags: ['kurczak', 'drób', 'mięso'], forbid: ['wege', 'ryba', 'deser'] },
  { re: /\b(indyk|turkey)/, tags: ['indyk', 'drób', 'mięso'], forbid: ['wege', 'ryba'] },
  { re: /\b(wolow|beef|stek|steak|ribeye|tomahawk|rostbef|brisket|tatar)/, tags: ['wołowina', 'mięso', 'stek'], forbid: ['wege', 'ryba', 'deser'] },
  { re: /\b(wieprz|pork|schab|golonk|boczek|bacon|pulled.?pork|zeberk)/, tags: ['wieprzowina', 'mięso'], forbid: ['wege', 'ryba', 'deser'] },
  { re: /\b(jagni|lamb)/, tags: ['jagnięcina', 'mięso'], forbid: ['wege', 'ryba'] },
  { re: /\b(cielęc|cielec|veal)/, tags: ['cielęcina', 'mięso'], forbid: ['wege'] },
  { re: /\b(ryb|fish|losos|dorsz|pstrag|tunczyk|dorada|sandacz|makrel|sashimi|nigiri)/, tags: ['ryba', 'owoce morza'], forbid: ['wołowina', 'wieprzowina', 'deser'] },
  { re: /\b(krewet|shrimp|owoc.?morz|seafood|osmig|kalmar|malz)/, tags: ['owoce morza', 'ryba'], forbid: ['wołowina', 'deser'] },
  { re: /\b(wege|vegan|tofu|tempeh|falafel|halloumi|buddha|kalafior.?chim)/, tags: ['wege', 'warzywa'], forbid: ['wołowina', 'wieprzowina', 'kurczak', 'kaczka', 'ryba'] },
  { re: /\b(zupa|soup|rosol|barszcz|zurek|gazpacho|ramen|pho|miso|chowder|bisque|krem.?)/, tags: ['zupa'], forbid: ['deser', 'pizza'] },
  { re: /\b(pomidor|tomato|marinara|gazpacho|bolognese)/, tags: ['pomidor', 'czerwone'], forbid: [] },
  { re: /\b(burger|cheeseburger|smash)/, tags: ['burger', 'mięso'], forbid: ['zupa', 'deser'] },
  { re: /\b(pizza|calzone|margherit)/, tags: ['pizza'], forbid: ['zupa', 'deser'] },
  { re: /\b(makaron|pasta|spaghetti|penne|lasagne|ravioli|gnocchi|carbonara)/, tags: ['makaron', 'pasta'], forbid: ['zupa'] },
  { re: /\b(salatk|salad)/, tags: ['sałatka'], forbid: ['zupa', 'pizza'] },
  { re: /\b(pierog|dumpling|gyoza|wonton|kopytk|kluski)/, tags: ['pierogi', 'kluski'], forbid: [] },
  { re: /\b(sos|sauce|aioli|dip|gravy)/, tags: ['sos'], forbid: ['deser', 'napój'] },
  { re: /\b(deser|ciasto|cake|tort|lody|ice.?cream|tiramisu|pancake|nalesnik)/, tags: ['deser', 'słodkie'], forbid: ['mięso', 'zupa', 'ryba'] },
  { re: /\b(kawa|coffee|espresso|cappuccino)/, tags: ['kawa', 'napój'], forbid: ['mięso', 'zupa'] },
  { re: /\b(herbata|tea|matcha)/, tags: ['herbata', 'napój'], forbid: ['mięso'] },
  { re: /\b(lemoniad|sok |juice|smoothie|drink|koktajl|piwo|beer|wino|wine|spirits|energetyk)/, tags: ['napój'], forbid: ['mięso', 'zupa'] },
  { re: /\b(sushi|maki|uramaki|futomaki)/, tags: ['sushi', 'ryba'], forbid: ['wołowina', 'deser'] },
  { re: /\b(kebab|shawarma|gyros)/, tags: ['kebab', 'mięso'], forbid: ['deser'] },
  { re: /\b(bbq|grill|pieczen|pieczon|roast|udo|udko)/, tags: ['pieczeń', 'grill', 'mięso pieczone'], forbid: ['deser', 'wege'] },
  { re: /\b(jablk|apple)/, tags: ['jabłko', 'owoce'], forbid: [] },
  { re: /\b(pekin|peking)/, tags: ['kaczka', 'azja', 'drób'], forbid: ['wege'] },
  { re: /\b(chrupiac|crispy)/, tags: ['chrupiące'], forbid: [] },
  { re: /\b(sniadan|breakfast|jajeczn|omlet|benedykt)/, tags: ['śniadanie', 'jajka'], forbid: [] },
];

const FOLDER_DEFAULT_TAGS = {
  asian: ['azja'],
  indian: ['indyjska'],
  mexican: ['meksykańska'],
  mediterranean: ['śródziemnomorska'],
  caucasian: ['kaukaska'],
  vegan: ['wege', 'warzywa'],
  fish: ['ryba'],
  roasts: ['pieczeń', 'mięso pieczone'],
  dinners: ['danie główne'],
  soups_pl: ['zupa'],
  soups_polish: ['zupa', 'polska'],
  soups_asia: ['zupa', 'azja'],
  sauces: ['sos'],
  burgers: ['burger'],
  pizzas: ['pizza'],
  pastas: ['makaron'],
  salads: ['sałatka'],
  sushi: ['sushi'],
  bbq: ['bbq', 'grill'],
  polish: ['polska'],
};

function normalize(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s_]/g, ' ')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCasePl(slugOrName) {
  const words = normalize(slugOrName).split(' ').filter(Boolean);
  return words
    .map((w) => {
      if (['z', 'ze', 'w', 'na', 'do', 'po', 'i', 'a', 'de', 'la'].includes(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

function walkImages(dir, base = dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    if (EXCLUDE_PATH_RE.test(rel)) continue;
    if (ent.isDirectory()) {
      out.push(...walkImages(full, base));
      continue;
    }
    const ext = path.extname(ent.name).toLowerCase();
    if (!IMAGE_EXT.has(ext)) continue;
    out.push({ full, rel, fileName: ent.name, folder: rel.split('/')[0] || '' });
  }
  return out;
}

function parseCatalogEntries() {
  const map = new Map();
  if (!fs.existsSync(LIB_DIR)) return map;
  const files = fs.readdirSync(LIB_DIR).filter((f) => /Catalog\.ts$/.test(f) || f === 'dishImagesCatalog.ts');
  for (const f of files) {
    const text = fs.readFileSync(path.join(LIB_DIR, f), 'utf8');
    for (const line of text.split(/\n/)) {
      if (!line.includes('slug:') || !line.includes('storagePath:') || !line.includes('labelPl:')) continue;
      const slug = (line.match(/slug:\s*'([^']+)'/) || [])[1];
      const labelPl = (line.match(/labelPl:\s*'((?:\\'|[^'])*)'/) || [])[1];
      const storagePath = (line.match(/storagePath:\s*'([^']+)'/) || [])[1];
      if (!slug || !storagePath || !/dania\//.test(storagePath)) continue;
      const aliasesRaw = (line.match(/aliases:\s*\[([^\]]*)\]/) || [])[1] || '';
      const aliases = [...aliasesRaw.matchAll(/'((?:\\'|[^'])*)'/g)].map((m) => m[1].replace(/\\'/g, "'"));
      map.set(storagePath.replace(/\\/g, '/'), { slug, labelPl, aliases, storagePath });
    }
  }
  return map;
}

function heuristicTags(blob, folder) {
  const n = normalize(blob);
  const tags = new Set();
  const forbid = new Set();
  for (const rule of KEYWORD_TAGS) {
    if (rule.re.test(n)) {
      rule.tags.forEach((t) => tags.add(t));
      rule.forbid.forEach((t) => forbid.add(t));
    }
  }
  for (const t of FOLDER_DEFAULT_TAGS[folder] || []) tags.add(t);
  if (folder === 'vegan') {
    ['wołowina', 'wieprzowina', 'kurczak', 'kaczka', 'ryba'].forEach((t) => forbid.add(t));
  }
  if (folder === 'fish' || folder === 'sushi') {
    ['wołowina', 'wieprzowina', 'deser'].forEach((t) => forbid.add(t));
  }
  for (const t of tags) forbid.delete(t);
  return {
    fallbackTags: [...tags],
    forbiddenTags: [...forbid],
  };
}

function buildEntry(fileMeta, catalogMeta, index) {
  const storagePath = `dania/${fileMeta.rel}`;
  const cat = catalogMeta.get(storagePath);
  const slug =
    cat?.slug ||
    normalize(path.basename(fileMeta.fileName, path.extname(fileMeta.fileName))).replace(/\s+/g, '_');
  const primaryName = cat?.labelPl || titleCasePl(slug.replace(/_/g, ' '));
  const folder = fileMeta.folder;
  const category = FOLDER_CATEGORY[folder] || 'Danie';
  const blob = `${slug} ${primaryName} ${(cat?.aliases || []).join(' ')} ${folder}`;
  const { fallbackTags, forbiddenTags } = heuristicTags(blob, folder);
  for (const tok of normalize(primaryName).split(' ')) {
    if (tok.length >= 4 && !['danie', 'klasyczny', 'klasyczna', 'swiezy', 'swieza'].includes(tok)) {
      if (!fallbackTags.includes(tok)) fallbackTags.push(tok);
    }
  }
  return {
    id: `img_${String(index + 1).padStart(4, '0')}`,
    slug,
    fileName: fileMeta.fileName,
    relativePath: fileMeta.rel,
    storagePath,
    primaryName,
    aliases: cat?.aliases || [],
    category,
    folder,
    fallbackTags,
    forbiddenTags,
  };
}

async function enrichWithOpenAI(entries) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.warn('[enrich] OPENAI_API_KEY missing — skipping OpenAI pass.');
    return { enriched: 0, skipped: true };
  }
  const batchSize = 25;
  let enriched = 0;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const payload = batch.map((e) => ({
      id: e.id,
      fileName: e.fileName,
      primaryName: e.primaryName,
      category: e.category,
      fallbackTags: e.fallbackTags,
      forbiddenTags: e.forbiddenTags,
    }));
    const body = {
      model: process.env.OPENAI_IMAGE_TAG_MODEL || 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Jesteś taggerem grafik dań restauracyjnych (PL). Dla każdej pozycji popraw/uzupełnij fallbackTags (5–10) i forbiddenTags (dietetyczne konflikty). Nie zmieniaj id. Zwróć JSON: {"items":[{"id","fallbackTags","forbiddenTags","primaryName?"}]}.',
        },
        { role: 'user', content: JSON.stringify({ items: payload }) },
      ],
    };
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.warn(`[enrich] batch ${i}: HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(raw);
      const byId = new Map((parsed.items || []).map((x) => [x.id, x]));
      for (const e of batch) {
        const hit = byId.get(e.id);
        if (!hit) continue;
        if (Array.isArray(hit.fallbackTags) && hit.fallbackTags.length) {
          e.fallbackTags = hit.fallbackTags.map(String);
        }
        if (Array.isArray(hit.forbiddenTags)) e.forbiddenTags = hit.forbiddenTags.map(String);
        if (hit.primaryName) e.primaryName = String(hit.primaryName);
        enriched += 1;
      }
      console.log(`[enrich] ${Math.min(i + batchSize, entries.length)}/${entries.length}`);
    } catch (err) {
      console.warn(`[enrich] batch ${i} failed:`, err.message || err);
    }
  }
  return { enriched, skipped: false };
}

async function main() {
  const wantEnrich = process.argv.includes('--enrich');
  const files = walkImages(DISHES_DIR);
  const catalog = parseCatalogEntries();
  console.log(`Found ${files.length} dish images under assets/premium/dishes`);
  console.log(`Parsed ${catalog.size} catalog dish entries`);

  const entries = files.map((f, i) => buildEntry(f, catalog, i));
  let enrichMeta = { enriched: 0, skipped: true, reason: 'not requested' };
  if (wantEnrich) {
    enrichMeta = await enrichWithOpenAI(entries);
    if (enrichMeta.skipped) enrichMeta.reason = 'OPENAI_API_KEY missing';
    else enrichMeta.reason = 'ok';
  }

  const library = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'heuristic+catalog',
    enrich: enrichMeta,
    count: entries.length,
    packagingExcluded: true,
    images: entries,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(library, null, 2), 'utf8');
  console.log(`Wrote ${entries.length} entries → ${path.relative(FRONTEND, OUT_PATH)}`);
  if (!wantEnrich) {
    console.log('OpenAI enrich not run (pass --enrich with OPENAI_API_KEY to enrich tags).');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
