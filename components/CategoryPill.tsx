import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Colors } from '@/constants/colors';

interface CategoryPillProps {
  label: string;
  color: string;
  selected: boolean;
  onPress: () => void;
}

export function CategoryPill({ label, color, selected, onPress }: CategoryPillProps) {
  return (
    <TouchableOpacity
      style={[styles.pill, selected && { backgroundColor: color, borderColor: color }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={[styles.dot, { backgroundColor: selected ? Colors.white : color }]} />
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

interface CategoryPillsBarProps {
  categories: Array<{ id: string; name: string; color: string }>;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

export function CategoryPillsBar({ categories, selected, onSelect }: CategoryPillsBarProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.bar}
    >
      <TouchableOpacity
        style={[styles.pill, selected === null && styles.pillAllSelected]}
        onPress={() => onSelect(null)}
        activeOpacity={0.75}
      >
        <Text style={[styles.label, selected === null && styles.labelSelected]}>Wszystkie</Text>
      </TouchableOpacity>
      {categories.map((cat) => (
        <CategoryPill
          key={cat.id}
          label={cat.name}
          color={cat.color}
          selected={selected === cat.id}
          onPress={() => onSelect(cat.id)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  pillAllSelected: {
    backgroundColor: Colors.textPrimary,
    borderColor: Colors.textPrimary,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  labelSelected: {
    color: Colors.white,
    fontWeight: '600',
  },
});
