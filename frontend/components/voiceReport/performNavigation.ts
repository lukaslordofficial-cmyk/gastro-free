import type { Intent } from './types';

export type InventoryCascadeItem = {
  id: string;
  name: string;
  quantity: number;
  minQuantity: number;
  unit: string;
};

export type PerformNavigationDeps = {
  transcript: string;
  onClose: () => void;
  router: { push: (href: any) => void };
  openProductCascade: (opts: {
    title: string;
    subtitle: string;
    mode: 'critical' | 'stock_asc' | 'custom';
    items: InventoryCascadeItem[];
  }) => void;
  fetchInventoryRows: () => Promise<InventoryCascadeItem[]>;
};

async function openInventoryCascadeFromVoice(
  deps: PerformNavigationDeps,
  mode: 'critical' | 'stock_asc',
  title?: string,
) {
  try {
    const rows = await deps.fetchInventoryRows();
    const items =
      mode === 'critical'
        ? rows.filter((r) => r.quantity <= r.minQuantity)
        : [...rows].sort((a, b) => a.quantity - b.quantity);
    deps.openProductCascade({
      title:
        title ||
        (mode === 'critical' ? 'Produkty krytyczne' : 'Stan magazynowy (rosnąco)'),
      subtitle:
        mode === 'critical'
          ? `${items.length} produktów poniżej progu`
          : `${items.length} produktów · od najniższego stanu`,
      mode: mode === 'critical' ? 'critical' : 'stock_asc',
      items,
    });
  } catch {
    /* best-effort */
  }
}

/** Nawigacja / filtry UI po intencji Jarvis — bez React hooks. */
export function performNavigation(
  intent: Intent,
  payload: Record<string, any>,
  deps: PerformNavigationDeps,
) {
  const textHint = `${JSON.stringify(payload)} ${deps.transcript}`.toLowerCase();
  const wantsCritical =
    payload?.critical ||
    payload?.low_stock ||
    payload?.mode === 'critical' ||
    /krytycz|niski stan|uzupeln|uzupełn|brak(i)? magazyn/.test(textHint);
  const wantsStockAsc =
    payload?.sort === 'quantity_asc' ||
    payload?.mode === 'stock_asc' ||
    /od najnizsz|od najniższ|rosnąco|rosnaco|stan(u)? magazyn/.test(textHint);

  void (async () => {
    try {
      if (wantsCritical || (intent === 'filter_ui_inventory' && wantsCritical)) {
        await openInventoryCascadeFromVoice(deps, 'critical');
        deps.onClose();
        return;
      }
      if (wantsStockAsc || (intent === 'filter_ui_inventory' && wantsStockAsc)) {
        await openInventoryCascadeFromVoice(deps, 'stock_asc');
        deps.onClose();
        return;
      }
      if (intent === 'navigate_screen') {
        const screen = String(payload.screen || '');
        if (screen === 'magazyn' && wantsCritical) {
          await openInventoryCascadeFromVoice(deps, 'critical');
          deps.onClose();
          return;
        }
        const map: Record<string, any> = {
          index: '/(tabs)',
          menu: '/(tabs)/menu',
          magazyn: '/(tabs)/magazyn',
          dostawcy: '/(tabs)/dostawcy',
          ustawienia: '/(tabs)/ustawienia',
        };
        deps.router.push(map[screen] ?? '/(tabs)');
      } else if (intent === 'filter_ui_inventory') {
        // Domyślnie: kaskada produktów kategorii / całego magazynu
        const rows = await deps.fetchInventoryRows();
        const cat = String(payload.category || '').toLowerCase();
        const filtered = cat
          ? rows // brak kategorii w inventory_items w tym select — pokaż wszystkie
          : rows;
        deps.openProductCascade({
          title: cat ? `Magazyn · ${payload.category}` : 'Magazyn — produkty',
          subtitle: `${filtered.length} pozycji`,
          mode: 'custom',
          items: filtered,
        });
      } else if (intent === 'filter_ui_menu_blocked') {
        deps.router.push({ pathname: '/(tabs)/menu', params: { voiceBlocked: '1' } });
      }
    } catch {
      /* navigation best-effort */
    }
    deps.onClose();
  })();
}
