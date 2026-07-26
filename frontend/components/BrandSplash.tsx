import React, { useEffect } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

const LOGO = require('@/assets/images/brand-logo-splash.png');

/**
 * Animowany splash marki po natywnym Expo splash (ciemne tło + logo + puls).
 */
export function BrandSplash() {
  const scale = useSharedValue(0.88);
  const glow = useSharedValue(0.25);
  const ring = useSharedValue(0.85);

  useEffect(() => {
    scale.value = withSequence(
      withTiming(1.04, { duration: 520, easing: Easing.out(Easing.cubic) }),
      withTiming(1, { duration: 380, easing: Easing.inOut(Easing.quad) }),
    );
    glow.value = withRepeat(
      withSequence(
        withTiming(0.55, { duration: 900, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.22, { duration: 900, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    ring.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 1400, easing: Easing.out(Easing.quad) }),
        withTiming(0.88, { duration: 0 }),
      ),
      -1,
      false,
    );
  }, [glow, ring, scale]);

  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value,
    transform: [{ scale: 0.95 + glow.value * 0.12 }],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, 0.55 - (ring.value - 0.88) * 1.4),
    transform: [{ scale: ring.value }],
  }));

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(280)}
      style={styles.root}
      pointerEvents="auto"
    >
      <View style={styles.center}>
        <Animated.View style={[styles.glow, glowStyle]} />
        <Animated.View style={[styles.ring, ringStyle]} />
        <Animated.View style={logoStyle}>
          <Image source={LOGO} style={styles.logo} resizeMode="contain" />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

/** Minimalny czas pokazu animowanego splash (ms). */
export const BRAND_SPLASH_MIN_MS = 1600;

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0A120E',
    zIndex: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    width: 280,
    height: 280,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(0, 255, 120, 0.16)',
  },
  ring: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    borderWidth: 1.5,
    borderColor: 'rgba(92, 255, 176, 0.45)',
  },
  logo: {
    width: 240,
    height: 240,
  },
});
