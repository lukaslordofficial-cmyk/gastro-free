import type { Unit } from '@/types/menu';

export const FORM_CATEGORIES = [
  'Burgery',
  'Dania główne',
  'Sałatki',
  'Makarony',
  'Zupy',
  'Półprodukty',
];

export const CATEGORY_COLORS: Record<string, string> = {
  Burgery: '#D97706',
  'Dania główne': '#2563EB',
  Sałatki: '#16A34A',
  Makarony: '#7C3AED',
  Zupy: '#DC2626',
  Półprodukty: '#A855F7',
};

export const INV_CATEGORY_COLORS: Record<string, string> = {
  'Napoje/Alkohole': '#2563EB',
  Mięso: '#DC2626',
  Warzywa: '#16A34A',
  Przyprawy: '#D97706',
  'Środki czystości': '#7C3AED',
  'Przybory kuchenne': '#475569',
  Nabiał: '#0891B2',
  Pieczywo: '#78716C',
  Inne: '#64748B',
};

export const UNIT_OPTIONS = ['g', 'ml', 'szt', 'kg', 'L'];
export const INV_UNIT_OPTIONS: Unit[] = ['g', 'ml', 'szt', 'opak', 'L', 'kg'];
export const INV_PRESET_CATEGORIES = [
  'Mięso',
  'Warzywa',
  'Przyprawy',
  'Napoje/Alkohole',
  'Środki czystości',
  'Przybory kuchenne',
  'Nabiał',
  'Pieczywo',
  'Inne',
];
