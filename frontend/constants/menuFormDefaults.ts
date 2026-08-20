import { FORM_CATEGORIES, INV_PRESET_CATEGORIES } from '@/constants/menuUi';
import type { Unit } from '@/types/menu';

export const BLANK_DISH_FORM = {
  name: '',
  category: FORM_CATEGORIES[0],
  price: '',
};

export const BLANK_INV_FORM = {
  name: '',
  category: INV_PRESET_CATEGORIES[0],
  currentQty: '',
  criticalThreshold: '',
  unit: 'g' as Unit,
  isCombo: false,
  portionSize: '',
};
