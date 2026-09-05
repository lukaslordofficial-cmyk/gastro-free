/**
 * PDF z receptur użytkownika + udostępnianie / szkic e-maila.
 */
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { UserRecipe } from '@/lib/userRecipes';

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function recipeHtml(r: UserRecipe): string {
  const ings =
    r.ingredients?.length > 0
      ? `<ul>${r.ingredients
          .map(
            (i) =>
              `<li><strong>${esc(i.name)}</strong> — ${esc(String(i.quantity))} ${esc(i.unit || '')}</li>`,
          )
          .join('')}</ul>`
      : '<p><em>Brak składników</em></p>';
  const instr = (r.instructions || '').trim();
  const instrBlock = instr
    ? `<h3>Przepis</h3><p style="white-space:pre-wrap;line-height:1.45">${esc(instr)}</p>`
    : '';
  return `
    <section style="margin-bottom:28px;page-break-inside:avoid">
      <h2 style="margin:0 0 8px;font-size:18px">${esc(r.name)}</h2>
      <h3 style="margin:12px 0 6px;font-size:13px;color:#555">Składniki</h3>
      ${ings}
      ${instrBlock}
    </section>`;
}

export function buildRecipesEmailBody(recipes: UserRecipe[], restaurantName?: string): string {
  const header = restaurantName?.trim()
    ? `Receptury — ${restaurantName.trim()}\n\n`
    : 'Receptury z Gastro Manager\n\n';
  const blocks = recipes.map((r, idx) => {
    const ings =
      r.ingredients?.length > 0
        ? r.ingredients.map((i) => `  • ${i.name}: ${i.quantity} ${i.unit || ''}`).join('\n')
        : '  (brak składników)';
    const instr = (r.instructions || '').trim();
    return `${idx + 1}. ${r.name}\nSkładniki:\n${ings}${instr ? `\nPrzepis:\n${instr}` : ''}`;
  });
  return (
    `${header}W załączniku PDF z ${recipes.length} recepturami (lub treść poniżej).\n\n` +
    `${blocks.join('\n\n—\n\n')}\n`
  );
}

export async function generateRecipesPdfFile(
  recipes: UserRecipe[],
  opts?: { restaurantName?: string },
): Promise<{ uri: string; fileName: string }> {
  if (!recipes.length) throw new Error('Brak receptur do eksportu.');
  const title = opts?.restaurantName?.trim()
    ? `Receptury — ${esc(opts.restaurantName.trim())}`
    : 'Receptury — Gastro Manager';
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <style>
      body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;color:#111;padding:24px}
      h1{font-size:22px;margin:0 0 6px}
      .meta{color:#666;font-size:12px;margin-bottom:24px}
      ul{margin:0;padding-left:18px}
      li{margin-bottom:4px}
      h3{font-size:13px;margin:10px 0 4px}
    </style></head><body>
    <h1>${title}</h1>
    <p class="meta">${recipes.length} pozycji · ${new Date().toLocaleDateString('pl-PL')}</p>
    ${recipes.map(recipeHtml).join('')}
    </body></html>`;

  const printed = await Print.printToFileAsync({ html, base64: false });
  let uri = printed.uri;
  const fileName = `gastro-receptury_${new Date().toISOString().slice(0, 10)}.pdf`;

  if (Platform.OS !== 'web') {
    try {
      const FileSystem = await import('expo-file-system/legacy');
      const base = FileSystem.cacheDirectory || FileSystem.documentDirectory || '';
      if (base) {
        const dest = `${base}${fileName}`;
        const info = await FileSystem.getInfoAsync(dest);
        if (info.exists) await FileSystem.deleteAsync(dest, { idempotent: true });
        await FileSystem.copyAsync({ from: printed.uri, to: dest });
        uri = dest;
      }
    } catch {
      /* keep print uri */
    }
  }
  return { uri, fileName };
}

export async function shareRecipesPdf(uri: string, fileName: string): Promise<void> {
  if (Platform.OS === 'web') {
    await Print.printAsync({ html: '<p>PDF wygenerowany — użyj druku do zapisania.</p>' });
    return;
  }
  const can = await Sharing.isAvailableAsync();
  if (!can) throw new Error('Udostępnianie niedostępne na tym urządzeniu.');
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: fileName,
    UTI: 'com.adobe.pdf',
  });
}

/** Lista nr POS + nazwa dania (dla kasjerów). */
export async function sharePosNumberList(
  rows: Array<{ pos_id: string; name: string; category?: string | null }>,
): Promise<void> {
  const lines = rows.map((r) => `${r.pos_id}\t${r.name}${r.category ? ` (${r.category})` : ''}`);
  const text = `Lista numerów POS — Gastro Manager\n${new Date().toLocaleDateString('pl-PL')}\n\nNr\tDanie\n${lines.join('\n')}\n`;

  if (Platform.OS === 'web') {
    const Clipboard = await import('expo-clipboard');
    await Clipboard.setStringAsync(text);
    return;
  }

  const FileSystem = await import('expo-file-system/legacy');
  const base = FileSystem.cacheDirectory || FileSystem.documentDirectory || '';
  const fileName = `gastro-pos-numery_${new Date().toISOString().slice(0, 10)}.txt`;
  const path = `${base}${fileName}`;
  await FileSystem.writeAsStringAsync(path, text, { encoding: 'utf8' });
  const can = await Sharing.isAvailableAsync();
  if (!can) throw new Error('Udostępnianie niedostępne.');
  await Sharing.shareAsync(path, {
    mimeType: 'text/plain',
    dialogTitle: fileName,
  });
}
