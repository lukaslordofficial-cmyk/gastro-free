/**
 * Lekki eksport „Excel” (SpreadsheetML / .xls) bez dodatkowych zależności.
 * Excel / Google Sheets / LibreOffice otwierają te pliki poprawnie.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

export type ExcelSheet = {
  name: string;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
};

function escapeXml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cellXml(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return `<Cell><Data ss:Type="String"></Data></Cell>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : NaN;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(n) && /^-?\d+([.,]\d+)?$/.test(value.trim())) {
    return `<Cell><Data ss:Type="Number">${n}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${escapeXml(String(value))}</Data></Cell>`;
}

function sheetNameSafe(name: string): string {
  const cleaned = String(name || 'Arkusz')
    .replace(/[\\/*?:\[\]]/g, ' ')
    .trim()
    .slice(0, 31);
  return cleaned || 'Arkusz';
}

/** Buduje XML SpreadsheetML (Excel 2003 XML). */
export function buildSpreadsheetXml(sheets: ExcelSheet[]): string {
  const parts = sheets.map((sheet, idx) => {
    const name = sheetNameSafe(sheet.name || `Arkusz${idx + 1}`);
    const headerRow = `<Row>${sheet.headers.map((h) => cellXml(h)).join('')}</Row>`;
    const body = sheet.rows
      .map((r) => `<Row>${r.map((c) => cellXml(c)).join('')}</Row>`)
      .join('');
    return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${headerRow}${body}</Table></Worksheet>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
${parts.join('\n')}
</Workbook>`;
}

async function shareOrDownload(fileName: string, xml: string): Promise<void> {
  if (Platform.OS === 'web') {
    // @ts-expect-error web Blob/URL
    const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
    // @ts-expect-error web
    const url = URL.createObjectURL(blob);
    // @ts-expect-error web
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    // @ts-expect-error web
    URL.revokeObjectURL(url);
    return;
  }

  const base = FileSystem.cacheDirectory || FileSystem.documentDirectory || '';
  if (!base) throw new Error('Brak katalogu plików do zapisu.');
  const path = `${base}${fileName}`;
  const encoding =
    (FileSystem as { EncodingType?: { UTF8: string } }).EncodingType?.UTF8 ?? 'utf8';
  await FileSystem.writeAsStringAsync(path, xml, { encoding: encoding as 'utf8' });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('Udostępnianie plików jest niedostępne na tym urządzeniu.');
  }
  await Sharing.shareAsync(path, {
    mimeType: 'application/vnd.ms-excel',
    dialogTitle: fileName,
    UTI: 'com.microsoft.excel.xls',
  });
}

export async function shareExcelSheets(fileName: string, sheets: ExcelSheet[]): Promise<void> {
  if (!sheets.length) throw new Error('Brak danych do eksportu.');
  const safeName = fileName.endsWith('.xls') ? fileName : `${fileName}.xls`;
  const xml = buildSpreadsheetXml(sheets);
  await shareOrDownload(safeName, xml);
}
