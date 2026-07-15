import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { MenuItemWithRecipe } from '@/lib/types';

interface AccordionDishProps {
  item: MenuItemWithRecipe;
}

const CATEGORY_COLORS: Record<string, string> = {
  'Burgery': '#D97706',
  'Dania główne': '#2563EB',
  'Sałatki': '#16A34A',
  'Makarony': '#7C3AED',
  'Zupy': '#DC2626',
  'Desery': '#DB2777',
};

export function AccordionDish({ item }: AccordionDishProps) {
  const [expanded, setExpanded] = useState(false);
  const catColor = CATEGORY_COLORS[item.category] ?? Colors.textSecondary;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <View style={[styles.categoryDot, { backgroundColor: catColor }]} />
        <View style={styles.headerText}>
          <Text style={styles.name}>{item.name}</Text>
          <View style={styles.meta}>
            <Text style={[styles.category, { color: catColor }]}>{item.category}</Text>
            <Text style={styles.dot}>·</Text>
            <Text style={styles.posId}>POS: {item.pos_id}</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.price}>{item.price_pln.toFixed(0)} PLN</Text>
          {expanded
            ? <ChevronUp size={16} color={Colors.textSecondary} strokeWidth={2} />
            : <ChevronDown size={16} color={Colors.textSecondary} strokeWidth={2} />
          }
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.body}>
          <Text style={styles.recipeTitle}>Receptura — skład porcji</Text>
          {item.recipe_ingredients
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((ing, idx) => (
              <View key={ing.id} style={[styles.ingredientRow, idx === item.recipe_ingredients.length - 1 && styles.last]}>
                <View style={styles.bullet} />
                <Text style={styles.ingredientName}>{ing.ingredient_name}</Text>
                <Text style={styles.ingredientQty}>
                  {ing.quantity % 1 === 0 ? ing.quantity.toFixed(0) : ing.quantity.toFixed(1)} {ing.unit}
                </Text>
              </View>
            ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  categoryDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  headerText: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  category: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  dot: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  posId: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  headerRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  price: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  body: {
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 10,
  },
  recipeTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    gap: 10,
  },
  last: {
    borderBottomWidth: 0,
  },
  bullet: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.accent,
  },
  ingredientName: {
    flex: 1,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  ingredientQty: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.accent,
  },
});
