/**
 * Globalne odświeżanie list po mutacjach (magazyn, menu, finanse, dostawy).
 * Ekrany nasłuchują DeviceEventEmitter i przeładowują dane.
 */
import { DeviceEventEmitter } from 'react-native';
import { INVENTORY_CHANGED } from '@/services/supplierOrdersService';
import { RECIPE_INGREDIENTS_CHANGED } from '@/lib/recipeSync';

export const MENU_CHANGED = 'gm/menu-changed';
export const FINANCE_CHANGED = 'gm/finance-changed';
export const SUPPLIER_ORDERS_CHANGED = 'gm/supplier-orders-changed';
export const APP_DATA_CHANGED = 'gm/app-data-changed';

export type AppRefreshHint =
  | 'inventory'
  | 'menu'
  | 'finance'
  | 'orders'
  | 'all';

/** Emituj odświeżenie po udanej akcji użytkownika (głos / formularz / zapis). */
export function emitAppDataChanged(hint: AppRefreshHint = 'all'): void {
  DeviceEventEmitter.emit(APP_DATA_CHANGED, { hint });
  if (hint === 'inventory' || hint === 'all') {
    DeviceEventEmitter.emit(INVENTORY_CHANGED);
  }
  if (hint === 'menu' || hint === 'all') {
    DeviceEventEmitter.emit(MENU_CHANGED);
    DeviceEventEmitter.emit(RECIPE_INGREDIENTS_CHANGED, { menuItemId: null });
  }
  if (hint === 'finance' || hint === 'all') {
    DeviceEventEmitter.emit(FINANCE_CHANGED);
  }
  if (hint === 'orders' || hint === 'all') {
    DeviceEventEmitter.emit(SUPPLIER_ORDERS_CHANGED);
  }
}

/** Mapowanie intentów głosowych / apply → zakres odświeżenia. */
export function refreshHintForIntent(intent: string): AppRefreshHint {
  const i = (intent || '').toLowerCase();
  if (
    i.includes('inventory')
    || i.includes('waste')
    || i.includes('expiration')
    || i.includes('stock')
    || i === 'add_inventory_item'
    || i === 'increase_stock'
    || i === 'decrease_stock'
  ) {
    return 'inventory';
  }
  if (i.includes('menu') || i.includes('recipe') || i.includes('dish')) {
    return 'menu';
  }
  if (
    i.includes('revenue')
    || i.includes('cost')
    || i.includes('finance')
    || i.includes('fixed')
    || i.includes('variable')
  ) {
    return 'finance';
  }
  if (i.includes('order') || i.includes('supplier') || i.includes('basket')) {
    return 'orders';
  }
  return 'all';
}
