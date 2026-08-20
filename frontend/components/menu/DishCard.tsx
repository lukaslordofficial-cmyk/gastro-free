import React, { useEffect, useRef, useState } from 'react';
import { Animated, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { ChefHat, ChevronDown, CreditCard as Edit, Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { CATEGORY_COLORS } from '@/constants/menuUi';
import { DS } from '@/constants/premiumTheme';
import { PremiumBadge } from '@/components/premium/PremiumUI';
import { dishCardStyles as dishStyles } from '@/components/menu/dishCardStyles';
import type { Dish, DishThumbAssignment } from '@/types/menu';
import { formatPln } from '@/lib/format';
import { getDishCustomImageSync } from '@/lib/dishCustomImages';
import { getMenuThumbSync } from '@/lib/menuThumbCache';

export const DishCard = React.memo(function DishCard({
  dish,
  onEdit,
  onDelete,
  onBatchPrep,
  premium,
  thumb,
  onChangePhoto,
}: {
  dish: Dish;
  onEdit: (dish: Dish) => void;
  onDelete: (dish: Dish) => void;
  onBatchPrep?: (dish: Dish) => void;
  premium?: boolean;
  thumb?: DishThumbAssignment;
  onChangePhoto?: (dish: Dish) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  const catColor = CATEGORY_COLORS[dish.category] ?? Colors.textSecondary;
  const customUri = getDishCustomImageSync(dish.id);
  const liveThumb = thumb ?? getMenuThumbSync(dish.name);
  const liveSource = liveThumb?.source;
  const liveUri = typeof liveSource === 'object' && liveSource && 'uri' in liveSource
    ? liveSource.uri
    : undefined;
  const thumbSrc = customUri
    ? { uri: customUri }
    : typeof liveSource === 'number'
      ? liveSource
      : liveUri
        ? { uri: liveUri }
        : undefined;
  const [imgFailed, setImgFailed] = useState(false);
  const showThumb = thumbSrc != null && !imgFailed;

  useEffect(() => {
    setImgFailed(false);
  }, [dish.id, customUri, liveThumb?.slug, typeof liveSource === 'number' ? liveSource : liveUri]);

  const toggle = () => {
    const toValue = expanded ? 0 : 1;
    Animated.spring(anim, { toValue, useNativeDriver: true, tension: 60, friction: 9 }).start();
    setExpanded(!expanded);
  };

  const rotateIcon = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  if (premium) {
    return (
      <View style={dishStyles.premCard}>
        <TouchableOpacity style={dishStyles.premHeader} onPress={toggle} activeOpacity={0.8}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={(e) => {
              e.stopPropagation?.();
              onChangePhoto?.(dish);
            }}
            style={dishStyles.premThumbWrap}
          >
            {showThumb ? (
              <Image
                source={thumbSrc}
                style={dishStyles.premThumb}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={120}
                recyclingKey={customUri || liveThumb?.slug || dish.id}
                priority="low"
                onError={() => setImgFailed(true)}
              />
            ) : (
              <View style={dishStyles.premThumbPh} />
            )}
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text style={dishStyles.premName} numberOfLines={1} allowFontScaling={false}>{dish.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <PremiumBadge label={dish.category} tone="ok" />
              <Text style={dishStyles.premPos} allowFontScaling={false}>
                {dish.recipe.length > 0
                  ? `Receptura: ${dish.recipe.length} skł.`
                  : 'Brak receptury'}
              </Text>
            </View>
            {!!dish.pos_id && (
              <Text style={dishStyles.premPos} allowFontScaling={false}>POS: {dish.pos_id}</Text>
            )}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
            <Text style={dishStyles.premPrice} allowFontScaling={false}>{formatPln(dish.price_pln)}</Text>
            <Animated.View style={{ transform: [{ rotate: rotateIcon }] }}>
              <ChevronDown size={16} color={DS.color.muted} strokeWidth={2} />
            </Animated.View>
          </View>
        </TouchableOpacity>
        {expanded && (
          <View style={dishStyles.premBody}>
            <Text style={dishStyles.premRecipeLabel}>Receptura — skład porcji</Text>
            {dish.recipe.length === 0 ? (
              <TouchableOpacity
                style={dishStyles.premEdit}
                onPress={() => onEdit(dish)}
                activeOpacity={0.85}
              >
                <Edit size={14} color={DS.color.greenEnd} strokeWidth={2} />
                <Text style={{ color: DS.color.greenEnd, fontWeight: '700', fontSize: 13 }}>
                  Zbuduj recepturę
                </Text>
              </TouchableOpacity>
            ) : (
              dish.recipe.map((ing, idx) => (
                <View key={idx} style={dishStyles.premIngRow}>
                  <Text style={dishStyles.premIngName}>{ing.name}</Text>
                  <Text style={dishStyles.premIngQty}>
                    {ing.quantity % 1 === 0 ? ing.quantity.toFixed(0) : ing.quantity.toFixed(1)} {ing.unit}
                  </Text>
                </View>
              ))
            )}
            {onBatchPrep && dish.recipe.length > 0 ? (
              <TouchableOpacity
                style={dishStyles.premBatch}
                onPress={() => onBatchPrep(dish)}
                activeOpacity={0.85}
                testID={`batch-prep-open-${dish.id}`}
              >
                <ChefHat size={14} color="#0A0A0A" strokeWidth={2.5} />
                <Text style={dishStyles.premBatchText}>Przygotowanie partii</Text>
              </TouchableOpacity>
            ) : null}
            <View style={dishStyles.actionRow}>
              <TouchableOpacity style={dishStyles.premEdit} onPress={() => onEdit(dish)}>
                <Edit size={14} color={DS.color.greenEnd} strokeWidth={2} />
                <Text style={{ color: DS.color.greenEnd, fontWeight: '700', fontSize: 13 }}>Edytuj</Text>
              </TouchableOpacity>
              <TouchableOpacity style={dishStyles.premDel} onPress={() => onDelete(dish)}>
                <Trash2 size={14} color={DS.color.danger} strokeWidth={2} />
                <Text style={{ color: DS.color.danger, fontWeight: '700', fontSize: 13 }}>Usuń</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={dishStyles.container}>
      <TouchableOpacity style={dishStyles.header} onPress={toggle} activeOpacity={0.7}>
        {showThumb ? (
          <Image
            source={thumbSrc}
            style={dishStyles.stdThumb}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={120}
            recyclingKey={customUri || liveThumb?.slug || dish.id}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <View style={[dishStyles.catDot, { backgroundColor: catColor }]} />
        )}
        <View style={dishStyles.headerText}>
          <Text style={dishStyles.name}>{dish.name}</Text>
          <View style={dishStyles.meta}>
            <Text style={[dishStyles.category, { color: catColor }]}>{dish.category}</Text>
            {!!dish.pos_id && (
              <>
                <Text style={dishStyles.sep}>·</Text>
                <Text style={dishStyles.posId}>POS: {dish.pos_id}</Text>
              </>
            )}
          </View>
        </View>
        <View style={dishStyles.right}>
          <Text style={dishStyles.price}>{formatPln(dish.price_pln)}</Text>
          <Animated.View style={{ transform: [{ rotate: rotateIcon }] }}>
            <ChevronDown size={16} color={Colors.textSecondary} strokeWidth={2} />
          </Animated.View>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={dishStyles.body}>
          <Text style={dishStyles.recipeLabel}>Receptura — skład porcji</Text>
          {dish.recipe.length === 0 ? (
            <Text style={dishStyles.noRecipe}>Brak zdefiniowanych składników</Text>
          ) : (
            dish.recipe.map((ing, idx) => (
              <View key={idx} style={[dishStyles.ingRow, idx === dish.recipe.length - 1 && dishStyles.ingRowLast]}>
                <View style={dishStyles.bullet} />
                <Text style={dishStyles.ingName}>{ing.name}</Text>
                <Text style={dishStyles.ingQty}>
                  {ing.quantity % 1 === 0 ? ing.quantity.toFixed(0) : ing.quantity.toFixed(1)} {ing.unit}
                </Text>
              </View>
            ))
          )}
          <View style={dishStyles.costRow}>
            <Text style={dishStyles.costLabel}>Składniki: {dish.recipe.length} pozycji</Text>
            <View style={[dishStyles.priceBadge, { backgroundColor: Colors.accentLight }]}>
              <Text style={[dishStyles.priceBadgeText, { color: Colors.accent }]}>{formatPln(dish.price_pln)}</Text>
            </View>
          </View>

          <View style={dishStyles.actionRow}>
            <TouchableOpacity style={dishStyles.editBtn} onPress={() => onEdit(dish)} activeOpacity={0.8}>
              <Edit size={14} color={Colors.accent} strokeWidth={2} />
              <Text style={dishStyles.editBtnText}>Edytuj</Text>
            </TouchableOpacity>
            <TouchableOpacity style={dishStyles.deleteBtn} onPress={() => onDelete(dish)} activeOpacity={0.8}>
              <Trash2 size={14} color={Colors.danger} strokeWidth={2} />
              <Text style={dishStyles.deleteBtnText}>Usuń</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
});
