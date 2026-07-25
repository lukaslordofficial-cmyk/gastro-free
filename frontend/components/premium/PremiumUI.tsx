/**
 * Shared Premium UI primitives — one visual language for Magazyn / Menu / Finanse / Dostawcy.
 */
import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { DS, PremiumTokens } from '@/constants/premiumTheme';

const LOGO = require('@/assets/premium/gastro-manager-logo.webp');

/** ── Brand header ── */
export function PremiumBrandHeader({
  panelTitle,
  meta,
  right,
  variant = 'default',
}: {
  panelTitle: string;
  meta?: string;
  right?: React.ReactNode;
  /** default = brand + title|actions; magazyn = tylko tytuł + akcje pod spodem; centered = wyśrodkowane */
  variant?: 'default' | 'magazyn' | 'centered';
}) {
  if (variant === 'magazyn') {
    return (
      <View style={hdr.root}>
        <Text style={hdr.panelBig} numberOfLines={2} allowFontScaling={false}>
          {panelTitle}
        </Text>
        {!!meta && (
          <Text style={hdr.meta} numberOfLines={1} allowFontScaling={false}>
            {meta}
          </Text>
        )}
        {right ? <View style={hdr.actionsBelow}>{right}</View> : null}
      </View>
    );
  }

  if (variant === 'centered') {
    return (
      <View style={[hdr.root, hdr.centerRoot]}>
        <View style={hdr.centerBrandRow}>
          <Image source={LOGO} style={hdr.logoLg} contentFit="contain" />
          <Text style={hdr.brandLg} numberOfLines={1} allowFontScaling={false}>
            GASTRO <Text style={hdr.brandAccent}>MANAGER</Text>
          </Text>
        </View>
        <Text style={hdr.panelCenter} numberOfLines={2} allowFontScaling={false}>
          {panelTitle}
        </Text>
        {!!meta && (
          <Text style={[hdr.meta, { textAlign: 'center' }]} numberOfLines={1} allowFontScaling={false}>
            {meta}
          </Text>
        )}
        {right ? <View style={hdr.actionsBelowCenter}>{right}</View> : null}
      </View>
    );
  }

  return (
    <View style={hdr.root}>
      <View style={hdr.topRow}>
        <Image source={LOGO} style={hdr.logo} contentFit="contain" />
        <Text style={hdr.brand} numberOfLines={1} allowFontScaling={false}>
          GASTRO <Text style={hdr.brandAccent}>MANAGER</Text>
        </Text>
      </View>
      <View style={hdr.titleRow}>
        <View style={hdr.titleCol}>
          <Text style={hdr.panel} numberOfLines={2} allowFontScaling={false}>
            {panelTitle}
          </Text>
          {!!meta && (
            <Text style={hdr.meta} numberOfLines={1} allowFontScaling={false}>
              {meta}
            </Text>
          )}
        </View>
        {right ? <View style={hdr.right}>{right}</View> : null}
      </View>
    </View>
  );
}

const hdr = StyleSheet.create({
  root: {
    paddingHorizontal: DS.space.screen,
    paddingTop: 4,
    paddingBottom: 12,
  },
  centerRoot: { alignItems: 'center' },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  centerBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 10,
  },
  logo: { width: 32, height: 32, borderRadius: 8 },
  logoLg: { width: 44, height: 44, borderRadius: 11 },
  brand: {
    flex: 1,
    color: DS.color.heading,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  brandLg: {
    color: DS.color.heading,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  brandAccent: { color: DS.color.greenEnd },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  titleCol: { flex: 1, minWidth: 0 },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
    paddingTop: 2,
  },
  actionsBelow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  actionsBelowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  panel: {
    color: DS.color.heading,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
    lineHeight: 22,
  },
  panelBig: {
    color: DS.color.heading,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  panelCenter: {
    color: DS.color.heading,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 28,
    textAlign: 'center',
  },
  meta: {
    color: DS.color.muted,
    fontSize: 11,
    marginTop: 3,
    fontWeight: '500',
  },
});

/** ── Glass card ── */
export function PremiumCard({
  children,
  style,
  glow,
  pad = true,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  glow?: 'green' | 'red' | 'none';
  pad?: boolean;
}) {
  return (
    <View
      style={[
        card.base,
        glow === 'green' && DS.shadow.greenGlow,
        glow === 'red' && DS.shadow.redGlow,
        !pad && { padding: 0 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const card = StyleSheet.create({
  base: {
    backgroundColor: DS.color.surfaceCard,
    borderRadius: DS.radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DS.color.borderSubtle,
    padding: DS.space[24],
    ...DS.shadow.card,
  },
});

/** ── Soft outline pill button — filled asymmetric gradient + glow ── */
export function PremiumOutlineBtn({
  label,
  onPress,
  tone = 'green',
  icon,
  fullWidth,
  size = 'md',
}: {
  label: string;
  onPress: () => void;
  tone?: 'green' | 'red';
  icon?: React.ReactNode;
  fullWidth?: boolean;
  size?: 'md' | 'lg';
}) {
  const colors = tone === 'red' ? DS.gradient.red : DS.gradient.green;
  const glow = tone === 'red' ? DS.shadow.redGlow : DS.shadow.greenGlow;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.88}
      style={[outline.wrap, fullWidth && outline.fullWrap, glow]}
    >
      <LinearGradient
        colors={[...colors]}
        start={{ x: 0, y: 0.2 }}
        end={{ x: 1, y: 0.8 }}
        style={[
          outline.grad,
          fullWidth && outline.gradFull,
          size === 'lg' && outline.gradLg,
        ]}
      >
        {icon}
        <Text
          style={[
            outline.text,
            fullWidth && outline.textFull,
            size === 'lg' && outline.textLg,
          ]}
          allowFontScaling={false}
        >
          {label}
        </Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const outline = StyleSheet.create({
  wrap: {
    borderRadius: DS.radius.pill,
    alignSelf: 'flex-start',
  },
  fullWrap: { alignSelf: 'stretch' },
  grad: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: DS.radius.pill,
  },
  gradFull: {
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 6,
  },
  gradLg: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },
  text: { fontSize: 10, fontWeight: '800', color: '#0A0A0A' },
  textFull: { fontSize: 12 },
  textLg: { fontSize: 13 },
});

/** ── Primary glow CTA (Zgłoś informację) ── */
export function PremiumGlowCta({
  label,
  onPress,
  icon,
}: {
  label: string;
  onPress: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9} style={glowCta.wrap}>
      <LinearGradient
        colors={[...DS.gradient.green]}
        start={{ x: 0, y: 0.15 }}
        end={{ x: 1, y: 0.85 }}
        style={glowCta.grad}
      >
        {icon}
        <Text style={glowCta.text} allowFontScaling={false}>
          {label}
        </Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const glowCta = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
    borderRadius: DS.radius.pill,
    ...DS.shadow.greenGlow,
  },
  grad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: DS.radius.pill,
  },
  text: {
    color: '#0A0A0A',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.15,
  },
});

/** ── Category / filter capsule (Arc-style) ── */
export function PremiumCapsule({
  label,
  active,
  onPress,
  dotColor,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  dotColor?: string;
}) {
  if (active) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[cap.activeWrap, DS.shadow.greenGlow]}>
        <LinearGradient
          colors={[...DS.gradient.green]}
          start={{ x: 0, y: 0.2 }}
          end={{ x: 1, y: 0.8 }}
          style={cap.activeGrad}
        >
          <View style={[cap.dot, { backgroundColor: '#0A0A0A' }]} />
          <Text style={cap.activeText} allowFontScaling={false}>{label}</Text>
        </LinearGradient>
      </TouchableOpacity>
    );
  }
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={cap.base}>
      <View style={[cap.dot, { backgroundColor: dotColor || DS.color.muted }]} />
      <Text style={cap.text}>{label}</Text>
    </TouchableOpacity>
  );
}

const cap = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: DS.radius.pill,
    backgroundColor: DS.color.bgTertiary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DS.color.borderSubtle,
    marginRight: 8,
  },
  activeWrap: {
    borderRadius: DS.radius.pill,
    marginRight: 8,
  },
  activeGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: DS.radius.pill,
  },
  activeText: { color: '#0A0A0A', fontSize: 12, fontWeight: '800' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { color: DS.color.muted, fontSize: 12, fontWeight: '600' },
});

/** ── Stat tile (Stripe-style) ── */
export function PremiumStatTile({
  value,
  label,
  icon,
}: {
  value: string | number;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <View style={stat.tile}>
      {icon ? <View style={stat.icon}>{icon}</View> : null}
      <Text style={stat.value} numberOfLines={1} adjustsFontSizeToFit allowFontScaling={false}>
        {value}
      </Text>
      <Text style={stat.label} numberOfLines={1} adjustsFontSizeToFit allowFontScaling={false}>
        {label}
      </Text>
    </View>
  );
}

const stat = StyleSheet.create({
  tile: {
    flex: 1,
    backgroundColor: DS.color.surfaceCard,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DS.color.borderSubtle,
    paddingVertical: 10,
    paddingHorizontal: 8,
    ...DS.shadow.card,
    minHeight: 72,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  icon: { marginBottom: 4, opacity: 0.85 },
  value: {
    color: DS.color.heading,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  label: {
    color: DS.color.muted,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 3,
  },
});

/** ── Status badge (not full-card paint) ── */
export function PremiumBadge({
  label,
  tone = 'ok',
}: {
  label: string;
  tone?: 'ok' | 'critical' | 'warn' | 'neutral';
}) {
  const map = {
    ok: { bg: 'rgba(0,255,120,0.12)', fg: DS.color.greenEnd },
    critical: { bg: DS.color.dangerSoft, fg: DS.color.danger },
    warn: { bg: DS.color.warningSoft, fg: DS.color.warning },
    neutral: { bg: 'rgba(255,255,255,0.06)', fg: DS.color.muted },
  }[tone];
  return (
    <View style={[badge.base, { backgroundColor: map.bg }]}>
      <Text style={[badge.text, { color: map.fg }]}>{label}</Text>
    </View>
  );
}

const badge = StyleSheet.create({
  base: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: DS.radius.pill,
  },
  text: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
});

/** ── Apple-like alert banner ── */
export function PremiumAlertBanner({
  title,
  subtitle,
  onPress,
  icon,
}: {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.88}
      disabled={!onPress}
      style={alert.wrap}
    >
      <View style={alert.icon}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={alert.title}>{title}</Text>
        {!!subtitle && <Text style={alert.sub}>{subtitle}</Text>}
      </View>
      <Text style={alert.chev}>›</Text>
    </TouchableOpacity>
  );
}

const alert = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: DS.radius.card,
    backgroundColor: DS.color.surfaceElevated,
    borderWidth: 1,
    borderColor: DS.color.warningBorder,
    ...DS.shadow.card,
  },
  icon: { marginRight: 2 },
  title: { color: DS.color.warning, fontSize: 13, fontWeight: '700' },
  sub: { color: DS.color.muted, fontSize: 12, marginTop: 3 },
  chev: { color: DS.color.muted, fontSize: 20, fontWeight: '300' },
});

/** ── Jarvis / Clyde AI card with breathing glow ── */
export function PremiumJarvisCard({
  title = 'Clyde · Jarvis',
  subtitle,
  orb,
  trailing,
}: {
  title?: string;
  subtitle: string;
  orb?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const pulse = useSharedValue(0.55);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [pulse]);
  const glowStyle = useAnimatedStyle(() => ({
    opacity: 0.25 + pulse.value * 0.35,
    transform: [{ scale: 0.96 + pulse.value * 0.06 }],
  }));

  return (
    <View style={jarvis.wrap}>
      <Animated.View style={[jarvis.glow, glowStyle]} />
      <View style={jarvis.inner}>
        {orb}
        <View style={{ flex: 1, marginLeft: 10 }}>
          <View style={jarvis.titleRow}>
            <Text style={jarvis.title}>{title}</Text>
            <View style={jarvis.dot} />
            <Text style={jarvis.online}>ONLINE</Text>
          </View>
          <Text style={jarvis.sub} numberOfLines={2}>{subtitle}</Text>
        </View>
        {trailing}
      </View>
    </View>
  );
}

const jarvis = StyleSheet.create({
  wrap: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: DS.radius.card,
    overflow: 'visible',
  },
  glow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: DS.radius.card,
    backgroundColor: DS.color.greenGlow,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: DS.color.surfaceCard,
    borderRadius: DS.radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,255,136,0.18)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    ...DS.shadow.greenGlow,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: DS.color.heading, fontSize: 13, fontWeight: '700' },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: DS.color.greenEnd,
  },
  online: {
    color: DS.color.greenEnd,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  sub: {
    color: DS.color.body,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 3,
  },
});

/** Gradient action button on product cards */
export function PremiumGradientAction({
  label,
  onPress,
  tone = 'green',
  icon,
}: {
  label: string;
  onPress: () => void;
  tone?: 'green' | 'red';
  icon?: React.ReactNode;
}) {
  const colors =
    tone === 'red'
      ? (['#5A1A1A', '#2A1212'] as const)
      : (['#0F3D28', '#0A1F16'] as const);
  const fg = tone === 'red' ? DS.color.danger : DS.color.greenEnd;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88} style={{ borderRadius: DS.radius.button, overflow: 'hidden' }}>
      <LinearGradient colors={[...colors]} style={gradAct.btn}>
        {icon}
        <Text style={[gradAct.text, { color: fg }]}>{label}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const gradAct = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: DS.radius.button,
  },
  text: { fontSize: 12, fontWeight: '700' },
});

export const premiumRhythm = {
  screenPad: DS.space.screen,
  afterHero: DS.space[32],
  afterAlert: DS.space[24],
  section: DS.space[24],
  cards: DS.space[16],
};
