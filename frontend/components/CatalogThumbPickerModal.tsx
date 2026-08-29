import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Asset } from 'expo-asset';
import { X } from 'lucide-react-native';
import { DS } from '@/constants/premiumTheme';
import { listSimilarProductCatalogEntries } from '@/lib/productImages';
import { listSimilarDishCatalogEntries } from '@/lib/menuDishThumbs';

export type CatalogThumbPick = {
  slug: string;
  labelPl: string;
  /** file:// gotowe do set*CustomImage */
  uri: string;
};

type Props = {
  visible: boolean;
  title: string;
  queryName: string;
  mode: 'product' | 'dish';
  menuCategory?: string;
  onClose: () => void;
  onPick: (pick: CatalogThumbPick) => void;
};

type Row = {
  slug: string;
  labelPl: string;
  source: number | { uri: string };
};

async function sourceToFileUri(source: number | { uri: string }): Promise<string | null> {
  if (typeof source === 'object' && source?.uri) {
    if (source.uri.startsWith('file://') || source.uri.startsWith('content://')) return source.uri;
    // Remote — ImagePicker/compress i tak pobierze; expo-asset nie obsłuży HTTP
    return source.uri;
  }
  if (typeof source === 'number') {
    const asset = Asset.fromModule(source);
    await asset.downloadAsync();
    return asset.localUri || asset.uri || null;
  }
  return null;
}

export function CatalogThumbPickerModal({
  visible,
  title,
  queryName,
  mode,
  menuCategory,
  onClose,
  onPick,
}: Props) {
  const { width } = useWindowDimensions();
  const cols = width >= 720 ? 4 : 3;
  const gap = 10;
  const pad = 16;
  const cell = Math.floor((width - pad * 2 - gap * (cols - 1)) / cols);
  const [busySlug, setBusySlug] = useState<string | null>(null);

  const rows = useMemo<Row[]>(() => {
    if (!visible || !queryName.trim()) return [];
    if (mode === 'product') {
      return listSimilarProductCatalogEntries(queryName, 36).map((e) => ({
        slug: e.slug,
        labelPl: e.labelPl,
        source: e.source,
      }));
    }
    return listSimilarDishCatalogEntries(queryName, menuCategory, 36);
  }, [visible, queryName, mode, menuCategory]);

  async function handleSelect(row: Row) {
    if (busySlug) return;
    setBusySlug(row.slug);
    try {
      const uri = await sourceToFileUri(row.source);
      if (!uri) return;
      onPick({ slug: row.slug, labelPl: row.labelPl, uri });
      onClose();
    } finally {
      setBusySlug(null);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.sub} numberOfLines={2}>
              Podobne z katalogu dla „{queryName}” — wybierz zbliżoną kategorię
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <X size={20} color={DS.color.heading} strokeWidth={2.4} />
          </TouchableOpacity>
        </View>

        {rows.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Brak podpowiedzi w katalogu dla tej nazwy.</Text>
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(item) => item.slug}
            numColumns={cols}
            contentContainerStyle={{ paddingHorizontal: pad, paddingBottom: 40, gap }}
            columnWrapperStyle={{ gap }}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.cell, { width: cell }]}
                activeOpacity={0.85}
                onPress={() => void handleSelect(item)}
                disabled={!!busySlug}
              >
                <View style={[styles.thumbWrap, { width: cell, height: cell }]}>
                  <Image source={item.source} style={styles.thumb} contentFit="contain" />
                  {busySlug === item.slug ? (
                    <View style={styles.busy}>
                      <ActivityIndicator color="#C8F54B" />
                    </View>
                  ) : null}
                </View>
                <Text style={styles.label} numberOfLines={2}>
                  {item.labelPl}
                </Text>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: DS.color.bgPrimary },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DS.color.borderSubtle,
  },
  title: { color: DS.color.heading, fontSize: 18, fontWeight: '700' },
  sub: { color: DS.color.muted, fontSize: 12, marginTop: 4, lineHeight: 16 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DS.color.bgTertiary,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: DS.color.muted, textAlign: 'center' },
  cell: { marginBottom: 4 },
  thumbWrap: {
    borderRadius: DS.radius.image,
    backgroundColor: DS.color.bgTertiary,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DS.color.borderSubtle,
  },
  thumb: { width: '100%', height: '100%' },
  busy: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: DS.color.heading,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
    lineHeight: 14,
  },
});
