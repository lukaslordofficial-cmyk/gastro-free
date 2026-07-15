import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Plus, Mic, Camera } from 'lucide-react-native';
import { Colors } from '@/constants/colors';

interface FABMenuProps {
  onMicPress?: () => void;
  onCameraPress?: () => void;
}

export function FABMenu({ onMicPress, onCameraPress }: FABMenuProps) {
  const [open, setOpen] = useState(false);
  const animation = useRef(new Animated.Value(0)).current;

  function toggle() {
    Animated.spring(animation, {
      toValue: open ? 0 : 1,
      useNativeDriver: true,
      friction: 7,
      tension: 80,
    }).start();
    setOpen(!open);
  }

  const micTranslate = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -120],
  });

  const cameraTranslate = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -64],
  });

  const opacityAnim = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const rotateAnim = animation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '45deg'],
  });

  return (
    <View style={styles.container} pointerEvents="box-none">
      <Animated.View style={[styles.miniBtn, { transform: [{ translateY: micTranslate }], opacity: opacityAnim }]}>
        <TouchableOpacity
          style={[styles.miniFab, { backgroundColor: Colors.accent }]}
          onPress={() => { toggle(); onMicPress?.(); }}
          activeOpacity={0.85}
        >
          <Mic size={20} color={Colors.white} strokeWidth={2} />
        </TouchableOpacity>
        <View style={styles.miniLabel}>
          <Text style={styles.miniLabelText}>AI Głos</Text>
        </View>
      </Animated.View>

      <Animated.View style={[styles.miniBtn, { transform: [{ translateY: cameraTranslate }], opacity: opacityAnim }]}>
        <TouchableOpacity
          style={[styles.miniFab, { backgroundColor: Colors.success }]}
          onPress={() => { toggle(); onCameraPress?.(); }}
          activeOpacity={0.85}
        >
          <Camera size={20} color={Colors.white} strokeWidth={2} />
        </TouchableOpacity>
        <View style={styles.miniLabel}>
          <Text style={styles.miniLabelText}>Skanuj dostawę</Text>
        </View>
      </Animated.View>

      <TouchableOpacity style={styles.fab} onPress={toggle} activeOpacity={0.85}>
        <Animated.View style={{ transform: [{ rotate: rotateAnim }] }}>
          <Plus size={26} color={Colors.white} strokeWidth={2.5} />
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    alignItems: 'flex-end',
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  miniBtn: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  miniFab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  miniLabel: {
    backgroundColor: Colors.textPrimary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    position: 'absolute',
    right: 54,
  },
  miniLabelText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600',
  } as any,
});
