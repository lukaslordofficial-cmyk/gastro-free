/**
 * Generuje frontend/lib/dishAssets/* — lazy require per folder (~25 WebP).
 * Uruchom: node frontend/scripts/generate_dish_asset_loaders.mjs
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../assets/premium/dishes');
const outDir = path.join(__dirname, '../lib/dishAssets');
fs.mkdirSync(outDir, { recursive: true });

const folders = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const loaderEntries = [];
for (const folder of folders) {
  const dir = path.join(root, folder);
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.(webp|png|jpg|jpeg)$/i.test(f))
    .sort();
  if (!files.length) continue;

  const lines = files.map((f) => {
    return `  '${f}': require('@/assets/premium/dishes/${folder}/${f}'),`;
  });
  const body =
    `/** Auto-generated — nie edytuj ręcznie. */\n` +
    `export const ASSETS: Record<string, number> = {\n` +
    lines.join('\n') +
    `\n};\n`;
  fs.writeFileSync(path.join(outDir, `${folder}.ts`), body);
  loaderEntries.push(
    `  '${folder}': () => require('./${folder}') as { ASSETS: Record<string, number> },`,
  );
}

const index = `/** Auto-generated lazy loaders per folder (~25 WebP each). */
const LOADERS: Record<string, () => { ASSETS: Record<string, number> }> = {
${loaderEntries.join('\n')}
};

const cache = new Map<string, Record<string, number>>();

/** relativePath np. apps/app_01.webp lub dania/apps/app_01.webp → local require id */
export function resolveDishLocalAsset(relativePath: string): number | null {
  const clean = String(relativePath || '')
    .replace(/^dania\\//, '')
    .replace(/^\\/+/, '');
  const parts = clean.split('/');
  if (parts.length < 2) return null;
  const folder = parts[0];
  const file = parts.slice(1).join('/');
  let assets = cache.get(folder);
  if (!assets) {
    const loader = LOADERS[folder];
    if (!loader) return null;
    try {
      assets = loader().ASSETS;
    } catch {
      return null;
    }
    cache.set(folder, assets);
  }
  const id = assets[file];
  return typeof id === 'number' ? id : null;
}

export function warmDishAssetFolder(folder: string): void {
  if (cache.has(folder)) return;
  const loader = LOADERS[folder];
  if (!loader) return;
  try {
    cache.set(folder, loader().ASSETS);
  } catch {
    /* ignore */
  }
}

export const DISH_ASSET_FOLDERS = Object.keys(LOADERS);
`;

fs.writeFileSync(path.join(outDir, 'index.ts'), index);
console.log(`OK: ${loaderEntries.length} folders → ${outDir}`);
