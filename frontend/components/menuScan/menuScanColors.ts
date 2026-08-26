/**
 * Paleta skanera menu — wydzielona z MenuScanModal (.agentrules §I).
 */
import { DS } from '@/constants/premiumTheme';

export const MENU_SCAN_C = {
  bg: '#0A120E',
  card: DS.color.surfaceCard,
  elevated: DS.color.surfaceElevated,
  border: DS.color.borderSubtle,
  text: DS.color.heading,
  body: DS.color.body,
  muted: DS.color.muted,
  green: DS.color.greenEnd,
  greenSoft: 'rgba(0,255,120,0.12)',
  greenDeep: DS.color.greenStart,
  danger: DS.color.danger,
  dangerSoft: DS.color.dangerSoft,
  warning: DS.color.warning,
  warningSoft: DS.color.warningSoft,
  warningBorder: DS.color.warningBorder,
  blackOnGreen: '#0A0A0A',
  inputBg: DS.color.bgTertiary,
} as const;
