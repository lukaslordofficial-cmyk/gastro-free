import React, { useEffect, useState } from 'react';
import { Text, View, StyleSheet, type TextStyle, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { PremiumColors } from '@/constants/premiumTheme';

const GLITCH_CHARS = '$#@%&*01<>/\\|';

/** Matrix / glitch typing — literka po literce z losowymi znakami. */
export function GlitchTyping({
  text,
  style,
  charMs = 28,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  charMs?: number;
}) {
  const [shown, setShown] = useState('');

  useEffect(() => {
    let i = 0;
    let cancelled = false;
    setShown('');
    const tick = () => {
      if (cancelled) return;
      if (i >= text.length) {
        setShown(text);
        return;
      }
      const glitch = GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
      setShown(text.slice(0, i) + glitch);
      setTimeout(() => {
        if (cancelled) return;
        i += 1;
        setShown(text.slice(0, i));
        setTimeout(tick, charMs);
      }, 12);
    };
    const start = setTimeout(tick, 80);
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
  }, [text, charMs]);

  return <Text style={style}>{shown}</Text>;
}

/** Licznik od 0 → target z easingiem (odometer). Cała logika na JS — bez worklet/format. */
export function AnimatedCounter({
  value,
  duration = 1000,
  formatValue,
  style,
}: {
  value: number;
  duration?: number;
  formatValue: (n: number) => string;
  style?: StyleProp<TextStyle>;
}) {
  const [display, setDisplay] = useState(() => formatValue(0));

  useEffect(() => {
    let frame = 0;
    const start = Date.now();
    setDisplay(formatValue(0));

    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(formatValue(value * eased));
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, formatValue]);

  return <Text style={style}>{display}</Text>;
}

/** Delikatna lewitacja PNG produktu (local require lub remote URI). */
export function FloatingAsset({
  source,
  size = 72,
  style,
  delay = 0,
}: {
  source: number | { uri: string };
  size?: number;
  style?: StyleProp<ViewStyle>;
  delay?: number;
}) {
  const y = useSharedValue(0);

  useEffect(() => {
    const t = setTimeout(() => {
      y.value = withRepeat(
        withTiming(1, { duration: 4000, easing: Easing.inOut(Easing.sin) }),
        -1,
        true
      );
    }, delay);
    return () => clearTimeout(t);
  }, [delay, y]);

  const anim = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(y.value, [0, 1], [0, -6]) }],
  }));

  return (
    <Animated.View style={[anim, style]}>
      <Image
        source={source}
        style={{ width: size, height: size }}
        contentFit="contain"
        cachePolicy="memory-disk"
        transition={200}
      />
    </Animated.View>
  );
}

/** Neonowy pasek skanera nad produktem (low stock). */
export function LaserScanner({
  children,
  active,
  style,
}: {
  children: React.ReactNode;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useSharedValue(0);

  useEffect(() => {
    if (!active) return;
    t.value = withRepeat(
      withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }),
      -1,
      false
    );
  }, [active, t]);

  const beam = useAnimatedStyle(() => ({
    top: `${interpolate(t.value, [0, 1], [0, 100])}%`,
    opacity: active ? 0.85 : 0,
  }));

  return (
    <View style={[scanStyles.wrap, style]}>
      {children}
      {active ? (
        <Animated.View style={[scanStyles.beam, beam]} pointerEvents="none">
          <LinearGradient
            colors={['transparent', PremiumColors.cyan, 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const scanStyles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    position: 'relative',
  },
  beam: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
  },
});

/** Pulsująca sfera / waveform AI Jarvis. */
export function AiWaveOrb({ listening }: { listening?: boolean }) {
  const pulse = useSharedValue(0);
  const bars = [0.4, 0.7, 1, 0.55, 0.85, 0.5, 0.95, 0.65, 0.45];

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: listening ? 700 : 1600, easing: Easing.inOut(Easing.sin) }),
      -1,
      true
    );
  }, [listening, pulse]);

  const ring = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.08]) }],
    opacity: interpolate(pulse.value, [0, 1], [0.55, 1]),
  }));

  return (
    <View style={orbStyles.wrap}>
      <Animated.View style={[orbStyles.ring, ring]} />
      <View style={orbStyles.core}>
        <View style={orbStyles.bars}>
          {bars.map((h, i) => (
            <WaveBar key={i} base={h} index={i} active={!!listening} />
          ))}
        </View>
      </View>
    </View>
  );
}

function WaveBar({ base, index, active }: { base: number; index: number; active: boolean }) {
  const v = useSharedValue(base);
  useEffect(() => {
    v.value = withRepeat(
      withTiming(active ? Math.min(1, base + 0.35) : base * 0.7, {
        duration: 400 + index * 70,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true
    );
  }, [active, base, index, v]);

  const style = useAnimatedStyle(() => ({
    height: 6 + v.value * 14,
  }));

  return <Animated.View style={[orbStyles.bar, style]} />;
}

const orbStyles = StyleSheet.create({
  wrap: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 26,
    borderWidth: 1.2,
    borderColor: PremiumColors.neon,
    backgroundColor: PremiumColors.neonSoft,
  },
  core: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0F0F0F',
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 22,
  },
  bar: {
    width: 2.5,
    borderRadius: 2,
    backgroundColor: PremiumColors.neon,
  },
});
