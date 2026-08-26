import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Animated, Alert } from 'react-native';
import { Plus, Mic, Camera, Package } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { magazynScreenStyles as styles } from './magazynScreenStyles';

export type MagFabProps = {
  onAddProduct: () => void;
  onMic: () => void;
};

export function MagFab({ onAddProduct, onMic }: MagFabProps) {
  const [fabOpen, setFabOpen] = useState(false);
  const fabAnim = useRef(new Animated.Value(0)).current;

  function toggleFab() {
    Animated.spring(fabAnim, { toValue: fabOpen ? 0 : 1, useNativeDriver: true, friction: 7, tension: 80 }).start();
    setFabOpen((prev) => !prev);
  }
  function closeFab() {
    Animated.spring(fabAnim, { toValue: 0, useNativeDriver: true, friction: 7, tension: 80 }).start();
    setFabOpen(false);
  }
  function handleAddProductPress() {
    closeFab();
    onAddProduct();
  }
  function handleMicPress() {
    closeFab();
    onMic();
  }
  function handleCameraPress() {
    closeFab();
    Alert.alert(
      'Daty ważności — bez Vision AI',
      'Przy dużej dostawie:\n\n'
      + '1) Dostawcy → skan faktury → formularz partii (daty + ilości + przypomnienia 7/3/1).\n'
      + '2) Albo głosem: „Dodaj do twarogu datę ważności 20.08.2026, 4 sztuki”.\n\n'
      + 'To tańsze i szybsze niż skanowanie każdego produktu kamerą.',
      [{ text: 'OK' }],
    );
  }

  const addTranslateY = fabAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -192] });
  const micTranslateY = fabAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -132] });
  const cameraTranslateY = fabAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -72] });
  const miniOpacity = fabAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] });
  const fabRotate = fabAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });

  return (
    <View style={styles.fabContainer} pointerEvents="box-none">
      <Animated.View style={[styles.fabMini, { transform: [{ translateY: addTranslateY }], opacity: miniOpacity }]} pointerEvents={fabOpen ? 'auto' : 'none'}>
        <View style={styles.fabMiniLabel}>
          <Text style={styles.fabMiniLabelText}>Dodaj Produkt</Text>
        </View>
        <TouchableOpacity style={[styles.fabMiniBtn, { backgroundColor: Colors.accent }]} onPress={handleAddProductPress} activeOpacity={0.85}>
          <Package size={20} color={Colors.white} strokeWidth={2} />
        </TouchableOpacity>
      </Animated.View>
      <Animated.View style={[styles.fabMini, { transform: [{ translateY: micTranslateY }], opacity: miniOpacity }]} pointerEvents={fabOpen ? 'auto' : 'none'}>
        <View style={styles.fabMiniLabel}>
          <Text style={styles.fabMiniLabelText}>AI Głos</Text>
        </View>
        <TouchableOpacity style={[styles.fabMiniBtn, { backgroundColor: '#8B5CF6' }]} onPress={handleMicPress} activeOpacity={0.85}>
          <Mic size={20} color={Colors.white} strokeWidth={2} />
        </TouchableOpacity>
      </Animated.View>
      <Animated.View style={[styles.fabMini, { transform: [{ translateY: cameraTranslateY }], opacity: miniOpacity }]} pointerEvents={fabOpen ? 'auto' : 'none'}>
        <View style={styles.fabMiniLabel}>
          <Text style={styles.fabMiniLabelText}>Jak dodać daty?</Text>
        </View>
        <TouchableOpacity style={[styles.fabMiniBtn, { backgroundColor: Colors.success }]} onPress={handleCameraPress} activeOpacity={0.85}>
          <Camera size={20} color={Colors.white} strokeWidth={2} />
        </TouchableOpacity>
      </Animated.View>
      <TouchableOpacity
        style={styles.fabWrap}
        onPress={toggleFab}
        activeOpacity={0.85}
      >
        <View style={[styles.fab, { backgroundColor: Colors.accent }]}>
          <Animated.View style={{ transform: [{ rotate: fabRotate }] }}>
            <Plus size={26} color={Colors.white} strokeWidth={2.5} />
          </Animated.View>
        </View>
      </TouchableOpacity>
    </View>
  );
}
