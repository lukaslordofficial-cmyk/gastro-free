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

function isShareDismissed(e: unknown): boolean {
  const m = String((e as { message?: string })?.message || e || '').toLowerCase();
  return (
    m.includes('user did not share') ||
    m.includes('sharingcancelled') ||
    m.includes('sharing canceled') ||
    m.includes('share is not available')
  );
}

/** Lista nr POS + nazwa dania — PDF jak raporty (SAF na Androidzie lub share sheet). */
export async function sharePosNumberList(
  rows: Array<{ pos_id: string; name: string; category?: string | null }>,
): Promise<'saf' | 'share' | 'print'> {
  if (!rows.length) throw new Error('Brak pozycji z numerami POS.');

  const sorted = [...rows].sort((a, b) => {
    const na = parseInt(String(a.pos_id), 10);
    const nb = parseInt(String(b.pos_id), 10);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return String(a.pos_id).localeCompare(String(b.pos_id), 'pl');
  });

  const tableRows = sorted
    .map(
      (r) =>
        `<tr>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;font-weight:700;width:48px;vertical-align:top">${esc(String(r.pos_id))}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top">${esc(r.name)}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;min-height:36px;height:36px"></td>
        </tr>`,
    )
    .join('');

  const dateLabel = new Date().toLocaleDateString('pl-PL');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <style>
      body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;color:#111;padding:24px}
      h1{font-size:20px;margin:0 0 6px}
      .meta{color:#666;font-size:12px;margin-bottom:18px}
      table{width:100%;border-collapse:collapse}
      th{text-align:left;padding:8px 10px;border-bottom:2px solid #111;font-size:12px;text-transform:uppercase;letter-spacing:.03em}
      .hint{margin-top:20px;font-size:11px;color:#64748b;line-height:1.4}
    </style></head><body>
    <h1>Lista sprzedaży — numery potraw</h1>
    <p class="meta">Gastro Manager · ${esc(dateLabel)} · ${sorted.length} potraw · data zmiany: __________</p>
    <table>
      <thead><tr><th style="width:48px">Nr</th><th>Danie</th><th style="width:42%">Znaczniki (x / I / ✓…)</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <p class="hint">Kasjer zaznacza sprzedaż w kolumnie po prawej (każdy znacznik = 1 szt.). Na koniec dnia zeskanuj kartkę w Magazyn → Skan sprzedaży — system rozpozna numery, zdejmie składniki z receptur i dopisze sprzedaż do dnia z nagłówka / daty na dokumencie.</p>
    </body></html>`;

  const fileName = `gastro-pos-numery_${new Date().toISOString().slice(0, 10)}.pdf`;

  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return 'print';
  }

  let printUri: string;
  try {
    const printed = await Print.printToFileAsync({ html, base64: false });
    printUri = printed.uri;
  } catch {
    throw new Error('Nie udało się wygenerować PDF listy numerów.');
  }

  let shareUri = printUri;
  try {
    const FileSystem = await import('expo-file-system/legacy');
    const base = FileSystem.cacheDirectory || FileSystem.documentDirectory || '';
    if (base) {
      const dest = `${base}${fileName}`;
      const info = await FileSystem.getInfoAsync(dest);
      if (info.exists) await FileSystem.deleteAsync(dest, { idempotent: true });
      await FileSystem.copyAsync({ from: printUri, to: dest });
      shareUri = dest;
    }
  } catch {
    shareUri = printUri;
  }

  // Android: bezpośredni zapis do Pobranych / wybranego folderu.
  if (Platform.OS === 'android') {
    try {
      const FileSystem = await import('expo-file-system/legacy');
      const SAF = FileSystem.StorageAccessFramework;
      if (SAF?.requestDirectoryPermissionsAsync) {
        const perm = await SAF.requestDirectoryPermissionsAsync();
        if (perm.granted && perm.directoryUri) {
          const b64 = await FileSystem.readAsStringAsync(shareUri, {
            encoding: 'base64',
          });
          const created = await SAF.createFileAsync(
            perm.directoryUri,
            fileName.replace(/\.pdf$/i, ''),
            'application/pdf',
          );
          await FileSystem.writeAsStringAsync(created, b64, { encoding: 'base64' });
          return 'saf';
        }
      }
    } catch {
      /* fallback: share sheet */
    }
  }

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    try {
      await Print.printAsync({ html });
      return 'print';
    } catch {
      throw new Error('Udostępnianie PDF jest niedostępne na tym urządzeniu.');
    }
  }

  try {
    await Sharing.shareAsync(shareUri, {
      mimeType: 'application/pdf',
      dialogTitle: fileName,
      UTI: 'com.adobe.pdf',
    });
    return 'share';
  } catch (e) {
    if (isShareDismissed(e)) return 'share';
    throw e instanceof Error ? e : new Error('Nie udało się udostępnić PDF listy.');
  }
}
