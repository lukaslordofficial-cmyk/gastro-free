import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Trash2,
  Plus,
  FlaskConical,
  PenLine,
  Tag,
  ShoppingCart,
} from 'lucide-react-native';
import { Image } from 'expo-image';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { PremiumBadge } from '@/components/premium/PremiumUI';
import { DS } from '@/constants/premiumTheme';
import { imageSourceForProduct } from '@/lib/productImages';
import { getProductCustomImageSync } from '@/lib/productCustomImages';
import type { MockInventoryItem } from './types';
import { formatQty, getStatus } from './helpers';

type Props = {
  item: MockInventoryItem;
  catColor: string;
  onDelete?: () => void;
  onPress?: () => void;
  onOrder?: () => void;
  onEdit?: () => void;
  /** Unikalny thumb z listy magazynu (jak menu). */
  libraryThumb?: number | { uri: string };
  onChangePhoto?: (item: MockInventoryItem) => void;
  /** Wymusza re-render po zmianie custom zdjęcia. */
  photoTick?: number;
  /** Podświetlenie po zapisie edycji. */
  highlighted?: boolean;
};

export function ItemCard({
  item,
  catColor,
  onDelete,
  onPress,
  onOrder,
  onEdit,
  libraryThumb,
  onChangePhoto,
  photoTick = 0,
  highlighted = false,
}: Props) {
  const theme = useAppTheme();
  const status = getStatus(item);
  const ratio = item.current_qty / Math.max(item.critical_threshold, 0.001);
  const fillPercent = Math.min(100, Math.round(ratio * 100));
  const customUri = getProductCustomImageSync(item.id);
  const librarySrc = useMemo(
    () => libraryThumb ?? imageSourceForProduct(item.product_name),
    [libraryThumb, item.product_name, photoTick],
  );
  const thumbSrc = customUri ? { uri: customUri } : librarySrc;
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    setImgFailed(false);
  }, [item.id, customUri, photoTick, typeof librarySrc === 'number' ? librarySrc : (librarySrc as { uri?: string })?.uri]);

  const isComboLow = item.is_combo_półprodukt && status !== 'ok';
  const lowStockActionLabel = isComboLow ? 'Dorób półprodukt' : 'Zamów u dostawcy';
  const lowStockHint = isComboLow
    ? status === 'critical'
      ? 'Ilość półproduktu spadła poniżej poziomu krytycznego — trzeba dorobić'
      : 'Niski stan półproduktu — zaplanuj doróbkę'
    : status === 'critical'
      ? 'Stan krytyczny — uzupełnij zapas'
      : 'Niski stan magazynowy';

  const Thumb = (
    <TouchableOpacity
      activeOpacity={onChangePhoto ? 0.85 : 1}
      onPress={(e) => {
        e?.stopPropagation?.();
        onChangePhoto?.(item);
      }}
      disabled={!onChangePhoto}
      hitSlop={6}
      testID={`inv-photo-${item.id}`}
    >
      {!imgFailed ? (
        <Image
          source={thumbSrc}
          style={theme.isPremium ? itemStyles.premThumb : itemStyles.thumb}
          contentFit="contain"
          cachePolicy="disk"
          transition={200}
          recyclingKey={`${item.id}:${customUri || 'lib'}:${photoTick}`}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <View
          style={[
            theme.isPremium ? itemStyles.premThumb : itemStyles.thumb,
            { backgroundColor: catColor, opacity: 0.35 },
          ]}
        />
      )}
    </TouchableOpacity>
  );

  if (theme.isPremium) {
    const edge =
      status === 'critical'
        ? DS.color.danger
        : status === 'warning'
          ? DS.color.warning
          : DS.color.greenEnd;
    const qtyColor =
      status === 'critical' ? DS.color.danger : status === 'warning' ? DS.color.warning : DS.color.heading;
    return (
      <TouchableOpacity
        activeOpacity={onPress ? 0.8 : 1}
        onPress={onPress}
        onLongPress={onEdit}
        style={[
          itemStyles.premCard,
          status === 'critical' && DS.shadow.redGlow,
          highlighted && { borderWidth: 2, borderColor: DS.color.greenEnd },
        ]}
      >
        <View style={[itemStyles.premEdge, { backgroundColor: edge }]} />
        <View style={itemStyles.premBody}>
          <View style={itemStyles.premTop}>
            {Thumb}
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Text style={itemStyles.premName} numberOfLines={1} allowFontScaling={false}>
                  {item.product_name}
                </Text>
                <PremiumBadge
                  label={status === 'critical' ? 'Krytyczny' : status === 'warning' ? 'Niski' : 'OK'}
                  tone={status === 'critical' ? 'critical' : status === 'warning' ? 'warn' : 'ok'}
                />
              </View>
              {item.variant ? (
                <View style={itemStyles.variantChip} testID={`inv-variant-${item.id}`}>
                  <Tag size={9} color={DS.color.greenEnd} strokeWidth={2.4} />
                  <Text style={itemStyles.variantChipText} numberOfLines={1}>
                    Odmiana: {item.variant}
                  </Text>
                </View>
              ) : null}
              <View style={itemStyles.qtyRow}>
                <Text style={[itemStyles.premQty, { color: qtyColor }]} allowFontScaling={false}>
                  {formatQty(item.current_qty, item.unit)}
                </Text>
                <Text style={itemStyles.premMin} allowFontScaling={false}>
                  {' '}
                  akt.
                  {item.optimal_threshold > 0
                    ? ` · opt ${formatQty(item.optimal_threshold, item.unit)}`
                    : ''}
                  {' · kryt '}
                  {formatQty(item.critical_threshold, item.unit)}
                </Text>
              </View>
              <View style={itemStyles.premProgressBg}>
                <View
                  style={[
                    itemStyles.premProgressFill,
                    { width: `${fillPercent}%` as `${number}%`, backgroundColor: edge },
                  ]}
                />
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 4 }}>
              {onEdit ? (
                <TouchableOpacity onPress={onEdit} hitSlop={10} style={{ padding: 4 }} testID={`edit-inv-${item.id}`}>
                  <PenLine size={14} color={DS.color.greenEnd} strokeWidth={2.4} />
                </TouchableOpacity>
              ) : null}
              {onDelete ? (
                <TouchableOpacity
                  onPress={onDelete}
                  hitSlop={10}
                  style={{ padding: 4 }}
                  testID={`delete-inv-${item.id}`}
                >
                  <Trash2 size={14} color={DS.color.danger} strokeWidth={2.2} />
                </TouchableOpacity>
              ) : null}
              {onOrder && !item.is_combo_półprodukt ? (
                <TouchableOpacity
                  onPress={onOrder}
                  activeOpacity={0.85}
                  style={[itemStyles.premOrderFabWrap, DS.shadow.greenGlow]}
                  hitSlop={8}
                >
                  <LinearGradient
                    colors={
                      status === 'critical' || status === 'warning'
                        ? [...DS.gradient.red]
                        : [...DS.gradient.green]
                    }
                    start={{ x: 0, y: 0.2 }}
                    end={{ x: 1, y: 0.8 }}
                    style={itemStyles.premOrderFab}
                  >
                    <Plus size={18} color="#0A0A0A" strokeWidth={2.5} />
                  </LinearGradient>
                </TouchableOpacity>
              ) : isComboLow && onEdit ? (
                <TouchableOpacity onPress={onEdit} hitSlop={10} style={{ padding: 4 }} testID={`remake-inv-${item.id}`}>
                  <FlaskConical size={16} color={DS.color.warning} strokeWidth={2.4} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  }

  const palette = {
    border:
      status === 'critical' ? Colors.danger : status === 'warning' ? Colors.warning : Colors.border,
    accent:
      status === 'critical' ? Colors.danger : status === 'warning' ? Colors.warning : catColor,
    qty: status === 'critical' ? Colors.danger : status === 'warning' ? Colors.warning : Colors.textPrimary,
    badgeBg:
      status === 'critical' ? Colors.dangerLight : status === 'warning' ? Colors.warningLight : Colors.accentLight,
    badgeText:
      status === 'critical' ? Colors.danger : status === 'warning' ? Colors.warning : Colors.accent,
  };

  return (
    <TouchableOpacity
      activeOpacity={onPress ? 0.85 : 1}
      onPress={onPress}
      onLongPress={onEdit}
      style={[
        itemStyles.card,
        { borderColor: highlighted ? Colors.accent : palette.border, backgroundColor: Colors.card },
        highlighted && { borderWidth: 2 },
      ]}
    >
      <View style={[itemStyles.accentBar, { backgroundColor: palette.accent }]} />
      <View style={itemStyles.body}>
        <View style={itemStyles.topRow}>
          {Thumb}
          <View style={itemStyles.nameRow}>
            <Text style={itemStyles.name} numberOfLines={2}>
              {item.product_name}
            </Text>
            {item.variant ? (
              <Text style={itemStyles.variantLine} numberOfLines={1}>
                {item.variant}
              </Text>
            ) : null}
            {item.is_combo_półprodukt ? (
              <View style={itemStyles.comboTag}>
                <FlaskConical size={9} color={Colors.accent} strokeWidth={2.4} />
                <Text style={itemStyles.comboText}>PÓŁPRODUKT</Text>
              </View>
            ) : null}
          </View>
          <View style={itemStyles.topRight}>
            <View style={[itemStyles.badge, { backgroundColor: palette.badgeBg }]}>
              <Text style={[itemStyles.badgeText, { color: palette.badgeText }]}>
                {status === 'critical' ? 'KRYTYCZNY' : status === 'warning' ? 'NISKI' : 'OK'}
              </Text>
            </View>
            {onDelete ? (
              <TouchableOpacity onPress={onDelete} hitSlop={8} style={itemStyles.deleteBtn}>
                <Trash2 size={14} color={Colors.danger} strokeWidth={2} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <View style={itemStyles.qtyRow}>
          <Text style={[itemStyles.qty, { color: palette.qty }]}>
            {formatQty(item.current_qty, item.unit)}
          </Text>
          <Text style={itemStyles.threshold}>
            {' / kryt '}
            {formatQty(item.critical_threshold, item.unit)}
          </Text>
        </View>
        {status !== 'ok' ? (
          <Text style={[itemStyles.portionAlert, { color: palette.badgeText }]}>{lowStockHint}</Text>
        ) : (
          <Text style={itemStyles.portionOk}>Stan w normie</Text>
        )}
        <View style={itemStyles.progressBg}>
          <View
            style={[
              itemStyles.progressFill,
              { width: `${fillPercent}%` as `${number}%`, backgroundColor: palette.accent },
            ]}
          />
        </View>

        {status !== 'ok' && (isComboLow ? onEdit : onOrder) && (
          <TouchableOpacity
            style={[itemStyles.orderBtn, { backgroundColor: palette.badgeText }]}
            onPress={isComboLow ? onEdit : onOrder}
            activeOpacity={0.85}
            testID={`order-btn-${item.id}`}
          >
            {isComboLow ? (
              <FlaskConical size={13} color={Colors.white} strokeWidth={2.5} />
            ) : (
              <ShoppingCart size={13} color={Colors.white} strokeWidth={2.5} />
            )}
            <Text style={itemStyles.orderBtnText}>{lowStockActionLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

export const itemStyles = StyleSheet.create({
  card: { flexDirection: 'row', borderRadius: 10, borderWidth: 1.5, marginBottom: 8, overflow: 'hidden' },
  accentBar: { width: 4 },
  body: { flex: 1, padding: 10, gap: 3 },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  nameRow: { flex: 1, gap: 3 },
  name: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary, lineHeight: 18 },
  variantLine: { fontSize: 10, fontWeight: '600', color: Colors.accent, marginTop: 1 },
  variantChip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  variantChipText: { fontSize: 10, fontWeight: '600', color: DS.color.greenEnd },
  comboTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'flex-start',
    backgroundColor: Colors.accentLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  comboText: { fontSize: 9, fontWeight: '700', color: Colors.accent, letterSpacing: 0.3 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7 },
  badgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.4 },
  deleteBtn: { padding: 2 },
  qtyRow: { flexDirection: 'row', alignItems: 'baseline' },
  qty: { fontSize: 18, fontWeight: '800', letterSpacing: -0.5 },
  threshold: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500' },
  portionAlert: { fontSize: 10, fontWeight: '700', letterSpacing: 0.1 },
  portionOk: { fontSize: 10, color: Colors.textSecondary },
  progressBg: { height: 3, backgroundColor: Colors.borderLight, borderRadius: 2, marginTop: 4, overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 2, minWidth: 4 },
  orderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 8,
    paddingVertical: 8,
    marginTop: 8,
  },
  orderBtnText: { fontSize: 12, fontWeight: '700', color: Colors.white, letterSpacing: 0.2 },
  premCard: {
    flexDirection: 'row',
    backgroundColor: DS.color.surfaceCard,
    borderRadius: DS.radius.card,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DS.color.borderSubtle,
    ...DS.shadow.card,
  },
  premEdge: { width: 3 },
  premBody: { flex: 1, padding: 12 },
  premTop: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  premThumb: {
    width: 48,
    height: 48,
    borderRadius: DS.radius.image,
    backgroundColor: DS.color.bgTertiary,
  },
  premName: {
    color: DS.color.heading,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  premQty: { fontSize: 18, fontWeight: '700', letterSpacing: -0.4 },
  premMin: { fontSize: 11, color: DS.color.muted, fontWeight: '500' },
  premProgressBg: {
    height: 3,
    backgroundColor: DS.color.bgTertiary,
    borderRadius: 2,
    marginTop: 4,
    overflow: 'hidden',
  },
  premProgressFill: { height: 3, borderRadius: 2, minWidth: 4 },
  premOrderFabWrap: { borderRadius: 999 },
  premOrderFab: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
