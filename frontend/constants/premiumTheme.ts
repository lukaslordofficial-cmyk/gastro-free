/**
 * GASTRO MANAGER PREMIUM DESIGN SYSTEM V1
 * Tokens + shared surface styles. Screens compose from these — never hardcode Material look.
 */
import { StyleSheet, type ViewStyle, type TextStyle } from 'react-native';

export const DS = {
  color: {
    bgPrimary: '#090909',
    bgSecondary: '#111111',
    bgTertiary: '#151515',
    surfaceCard: 'rgba(22,22,22,0.92)',
    surfaceElevated: 'rgba(28,28,28,0.94)',
    borderSubtle: 'rgba(255,255,255,0.05)',
    borderHover: 'rgba(255,255,255,0.08)',
    heading: '#F8F8F8',
    body: '#D3D3D3',
    muted: '#8A8A8A',
    greenStart: '#007A3D',
    greenMid: '#00D86B',
    greenEnd: '#5CFFB0',
    greenGlow: 'rgba(0,255,120,0.18)',
    danger: '#FF5A5A',
    dangerStart: '#8B1520',
    dangerEnd: '#FF6B6B',
    dangerGlow: 'rgba(255,90,90,0.14)',
    dangerSoft: 'rgba(255,90,90,0.12)',
    warning: '#F5C542',
    warningSoft: 'rgba(245,197,66,0.12)',
    warningBorder: 'rgba(245,197,66,0.28)',
  },
  radius: {
    card: 22,
    button: 18,
    pill: 999,
    bottomNav: 28,
    image: 14,
  },
  space: {
    4: 4,
    8: 8,
    12: 12,
    16: 16,
    24: 20,
    32: 24,
    48: 36,
    64: 48,
    screen: 16,
  },
  type: {
    display: { fontSize: 34, fontWeight: '700' as const, letterSpacing: -1 },
    h1: { fontSize: 26, fontWeight: '700' as const, letterSpacing: -0.6 },
    h2: { fontSize: 20, fontWeight: '600' as const, letterSpacing: -0.4 },
    h3: { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.2 },
    body: { fontSize: 14, fontWeight: '500' as const },
    caption: { fontSize: 12, fontWeight: '400' as const },
    micro: { fontSize: 10, fontWeight: '600' as const, letterSpacing: 0.4 },
  },
  shadow: {
    card: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.35,
      shadowRadius: 40,
      elevation: 10,
    } as ViewStyle,
    greenGlow: {
      shadowColor: '#00FF88',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.38,
      shadowRadius: 16,
      elevation: 10,
    } as ViewStyle,
    redGlow: {
      shadowColor: '#FF5A5A',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.32,
      shadowRadius: 14,
      elevation: 8,
    } as ViewStyle,
  },
  /** Asymetryczny fill: ciemniejszy start → jaśniejszy koniec */
  gradient: {
    green: ['#007A3D', '#00E676', '#7CFFC0'] as [string, string, string],
    red: ['#8B1520', '#E53935', '#FF8A80'] as [string, string, string],
  },
} as const;

/** Sync PremiumTokens / PremiumColors with DS V1 */
export const PremiumTokens = {
  color: {
    bg: DS.color.bgPrimary,
    bgMid: DS.color.bgSecondary,
    bgDeep: '#0C0C0C',
    card: DS.color.surfaceCard,
    cardElevated: DS.color.surfaceElevated,
    glass: 'rgba(22,22,22,0.72)',
    glassBorder: DS.color.borderSubtle,
    border: DS.color.borderSubtle,
    borderStrong: DS.color.borderHover,
    text: DS.color.heading,
    textBody: DS.color.body,
    textMuted: DS.color.muted,
    textFaint: '#5A5A5A',
    neon: DS.color.greenEnd,
    neonDeep: DS.color.greenStart,
    neonGlow: DS.color.greenGlow,
    neonSoft: 'rgba(0,255,120,0.10)',
    neonLine: 'rgba(0,255,136,0.35)',
    cyan: '#22D3EE',
    alert: DS.color.danger,
    alertSoft: DS.color.dangerSoft,
    alertBorder: 'rgba(255,90,90,0.22)',
    warning: DS.color.warning,
    warningSoft: DS.color.warningSoft,
    overlay: 'rgba(0,0,0,0.55)',
    shadow: '#000000',
  },
  type: {
    hero: { fontSize: 38, fontWeight: '700' as const, letterSpacing: -0.8, lineHeight: 44 },
    display: { ...DS.type.display, lineHeight: 48 },
    title: { fontSize: DS.type.h2.fontSize, fontWeight: DS.type.h2.fontWeight, letterSpacing: DS.type.h2.letterSpacing, lineHeight: 34 },
    section: { fontSize: DS.type.h3.fontSize, fontWeight: DS.type.h3.fontWeight, letterSpacing: DS.type.h3.letterSpacing, lineHeight: 28 },
    cardTitle: { fontSize: 18, fontWeight: '600' as const, letterSpacing: -0.2, lineHeight: 24 },
    body: { fontSize: DS.type.body.fontSize, fontWeight: DS.type.body.fontWeight, letterSpacing: 0, lineHeight: 24 },
    bodyLg: { fontSize: 16, fontWeight: '500' as const, letterSpacing: 0, lineHeight: 24 },
    caption: { fontSize: DS.type.caption.fontSize, fontWeight: DS.type.caption.fontWeight, letterSpacing: 0.1, lineHeight: 18 },
    micro: { fontSize: 11, fontWeight: '500' as const, letterSpacing: 0.3, lineHeight: 14 },
    stat: { fontSize: 36, fontWeight: '700' as const, letterSpacing: -1, lineHeight: 42 },
    statLg: { fontSize: 42, fontWeight: '700' as const, letterSpacing: -1.2, lineHeight: 48 },
  },
  space: {
    xs: DS.space[4],
    sm: DS.space[8],
    md: DS.space[16],
    lg: DS.space[24],
    xl: DS.space[32],
    xxl: DS.space[48],
    screen: DS.space.screen,
    section: DS.space[32],
    cardGap: DS.space[16],
    cardPad: DS.space[24],
    headerGap: DS.space[16],
  },
  radius: {
    sm: 14,
    md: 18,
    lg: DS.radius.button,
    xl: DS.radius.card,
    pill: DS.radius.pill,
  },
  elevation: {
    card: DS.shadow.card,
    soft: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.22,
      shadowRadius: 16,
      elevation: 4,
    },
    glowNeon: DS.shadow.greenGlow,
  },
  motion: {
    fast: 200,
    base: 280,
    slow: 350,
    easing: 'ease-out' as const,
  },
  icon: {
    stroke: 2,
    sm: 18,
    md: 22,
    lg: 26,
    gap: 12,
  },
  bgGradient: ['#090909', '#111111', '#0C0C0C'] as const,
  neonGradient: [DS.color.greenStart, DS.color.greenMid, DS.color.greenEnd] as const,
} as const;

export const PremiumColors = {
  bg: PremiumTokens.color.bg,
  card: '#161616',
  cardElevated: '#1C1C1C',
  border: PremiumTokens.color.border,
  text: PremiumTokens.color.text,
  textSecondary: PremiumTokens.color.textBody,
  textMuted: PremiumTokens.color.textMuted,
  neon: PremiumTokens.color.neon,
  neonAlt: PremiumTokens.color.neonDeep,
  cyan: PremiumTokens.color.cyan,
  alert: PremiumTokens.color.alert,
  alertSoft: PremiumTokens.color.alertSoft,
  neonSoft: PremiumTokens.color.neonSoft,
  glass: PremiumTokens.color.glass,
  shadow: PremiumTokens.color.shadow,
} as const;

export type PremiumColorKey = keyof typeof PremiumColors;

/** Glass card surface — depth without Material borders */
export function dsCardStyle(opts?: { glow?: 'green' | 'red' | 'none' }): ViewStyle {
  const glow =
    opts?.glow === 'green'
      ? DS.shadow.greenGlow
      : opts?.glow === 'red'
        ? DS.shadow.redGlow
        : DS.shadow.card;
  return {
    backgroundColor: DS.color.surfaceCard,
    borderRadius: DS.radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DS.color.borderSubtle,
    padding: DS.space[24],
    ...glow,
  };
}

export function dsHeadingStyle(): TextStyle {
  return { color: DS.color.heading, ...DS.type.h2 };
}

export function dsBodyStyle(): TextStyle {
  return { color: DS.color.body, ...DS.type.body };
}

export function dsMutedStyle(): TextStyle {
  return { color: DS.color.muted, ...DS.type.caption };
}
