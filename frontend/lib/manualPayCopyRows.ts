import { formatPln } from '@/lib/format';

export type ManualPayCopyRow = {
  key: string;
  label: string;
  value: string;
  emptyHint?: string;
};

export function buildManualPayCopyRows(opts: {
  supplierName: string;
  bankAccount: string | null;
  address: string | null;
  totalPln: number;
  orderTitle: string;
}): ManualPayCopyRow[] {
  const list: ManualPayCopyRow[] = [
    {
      key: 'bank',
      label: 'Numer konta bankowego',
      value: opts.bankAccount || '',
      emptyHint: 'Brak w profilu dostawcy — uzupełnij w module Dostawcy',
    },
    { key: 'name', label: 'Pełna nazwa dostawcy', value: opts.supplierName },
  ];
  if (opts.address) {
    list.push({ key: 'address', label: 'Adres dostawcy', value: opts.address });
  }
  list.push(
    { key: 'total', label: 'Łączna cena zamówienia', value: formatPln(opts.totalPln) },
    { key: 'title', label: 'Tytuł zamówienia', value: opts.orderTitle },
  );
  return list;
}
