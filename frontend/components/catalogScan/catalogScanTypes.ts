/**
 * Typy skanera dokumentów / katalogu — wydzielone z CatalogScanModal.
 */
import { DOC_WAREHOUSE_CATEGORIES } from '@/lib/warehouseCategories';

export const DOC_CATEGORIES = DOC_WAREHOUSE_CATEGORIES;

export type CatalogScanStage =
  | 'choose'
  | 'processing'
  | 'invoice_preview'
  | 'expiry_review'
  | 'result';

export interface InvoiceProduct {
  product_name: string;
  quantity: number;
  price_netto: number;
  unit: string;
  category: string;
  matched_inventory_name?: string | null;
  will_update_existing?: boolean;
}

/** Pola panelu Dostawcy wyodrębnione ze skanu (podgląd + zapis). */
export interface SupplierScanMeta {
  nip?: string | null;
  phone?: string | null;
  email?: string | null;
  contact_person?: string | null;
  address?: string | null;
  bank_account?: string | null;
  payment_terms?: string | null;
  shipping_cost?: number | null;
  min_order_value?: number | null;
  free_shipping_threshold?: number | null;
  lead_time_days?: number | null;
}

export interface DocResult {
  document_type: 'FAKTURA_ZAKUPOWA' | 'OFERTA_HANDLOWA' | 'MENU_RESTAURACYJNE';
  supplier_name?: string | null;
  supplier?: SupplierScanMeta | null;
  supplier_fields_updated?: string[];
  items_updated?: number;
  items_created?: number;
  products_on_invoice?: number;
  updated?: Array<{ name?: string; merged_from?: string | null; added?: number; unit?: string }>;
  created?: Array<{ name?: string; quantity?: number; unit?: string; category?: string }>;
  total_amount?: number;
  products_total?: number;
  visible_count?: number;
  hidden_count?: number;
  warnings?: string[];
  pages_total?: number | null;
  pages_processed?: number | null;
  pages_truncated?: boolean;
}
