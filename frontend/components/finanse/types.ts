export type EditableCostKind = 'fixed' | 'variable';

export type EditableCostRow = {
  id: string;
  name: string;
  amount_pln: number;
  year_month: string;
  kind: EditableCostKind;
};

export type InvoicePreviewState = {
  title: string;
  amount: number;
  note?: string | null;
};
