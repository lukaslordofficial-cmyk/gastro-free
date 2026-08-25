import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Platform, ScrollView, TextInput,
} from 'react-native';
import { Mic, Square, X, Check, AlertTriangle, RefreshCw, Send, Info, Plus, Trash2, ShieldAlert } from 'lucide-react-native';
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  getJarvisWakeWord,
  setJarvisWakeWord,
  setJarvisWakeListenEnabled,
  transcriptContainsWakeWord,
  stripWakeWord,
} from '@/lib/jarvisWakeWord';
import { DealHunterModal } from '../DealHunterModal';
import { ExpirationVoiceForm } from '../ExpirationVoiceForm';
import { PeriodPickerTree, labelForSelections, parsePeriodHintToSelection, type PeriodSelection } from '../PeriodPickerTree';
import {
  BulkPriceEditor,
  CriticalOrderEditor,
  DishPickEditor,
  IngredientNameSuggest,
  JarvisSuggestBox,
  MenuCategorySuggest,
  NavigateScreenEditor,
  OrderProductEditor,
  SupplierWithCatalogEditor,
} from '../JarvisFormExtras';
import { type OptimizeResult, normalizeOptimizeResult } from '@/lib/bargainHunter';
import {
  buildExpiryTipsForItem,
  EXPIRY_TIPS_LEGAL_DISCLAIMER,
} from '@/lib/expiryTipsCatalog';
import { fetchJson } from '@/lib/safeFetch';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { usePremiumAlert } from '@/components/PremiumAlert';
import {
  DEAL_HUNTER_GATE_MESSAGE,
  DEAL_HUNTER_GATE_TITLE,
  isDealHunterIntent,
} from '@/lib/dealHunterGate';
import { ProduceSizePicker } from '@/components/ProduceSizePicker';
import {
  findProduceConverter,
  piecesToKg,
  type ProduceSizeKey,
} from '@/lib/produceSizeConverter';
import { useAuth } from '@/contexts/AuthContext';

import { numOrNull } from './helpers';
import { Card, EditRow, FieldLabel } from './fields';
import { styles } from './styles';

export function ScaleRecipePicker({
  edited,
  patch,
}: {
  edited: Record<string, any>;
  patch: (p: Record<string, any>) => void;
}) {
  const [query, setQuery] = useState(String(edited.dish_name_resolved || edited.dish_name || ''));
  const [suggestions, setSuggestions] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const accepted = edited.dish_accepted === true && !!edited.dish_id;

  useEffect(() => {
    if (accepted) {
      setSuggestions([]);
      return;
    }
    const q = query.trim();
    if (q.length < 1) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        let { data, error } = await supabase
          .from('menu_items')
          .select('id, name')
          .ilike('name', `%${q}%`)
          .eq('is_active', true)
          .order('name')
          .limit(8);
        if (error) {
          const retry = await supabase
            .from('menu_items')
            .select('id, name')
            .ilike('name', `%${q}%`)
            .order('name')
            .limit(8);
          data = retry.data;
        }
        if (!cancelled) setSuggestions((data as any[]) ?? []);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, accepted]);

  return (
    <Card>
      <Text style={styles.editHint}>
        Wpisz nazwę dania z menu, wybierz podpowiedź i zaakceptuj — dopiero wtedy otworzysz kalkulator porcji.
      </Text>
      <FieldLabel text="Nazwa dania z menu" />
      <TextInput
        style={[styles.editInput, accepted && { borderColor: Colors.success, backgroundColor: '#F0FDF4' }]}
        value={query}
        onChangeText={(v) => {
          setQuery(v);
          patch({
            dish_name: v,
            dish_name_resolved: v,
            dish_id: null,
            dish_accepted: false,
          });
        }}
        placeholder="np. Sałatka Grecka"
        placeholderTextColor={Colors.textTertiary}
        testID="voice-scale-dish-search"
      />
      {loading ? <ActivityIndicator size="small" color={Colors.accent} style={{ marginVertical: 8 }} /> : null}
      {!accepted && suggestions.length > 0 && (
        <View style={styles.suggestBox} testID="voice-scale-suggestions">
          {suggestions.map((s) => (
            <TouchableOpacity
              key={s.id}
              style={styles.suggestRow}
              onPress={() => {
                setQuery(s.name);
                patch({
                  dish_id: s.id,
                  dish_name: s.name,
                  dish_name_resolved: s.name,
                  dish_accepted: true,
                  portions: edited.portions > 0 ? edited.portions : 10,
                });
                setSuggestions([]);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.suggestText}>{s.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {accepted ? (
        <View style={styles.acceptedDishBox}>
          <Text style={styles.acceptedDishText}>Wybrane: {edited.dish_name_resolved || edited.dish_name}</Text>
          <TouchableOpacity
            onPress={() => patch({ dish_id: null, dish_accepted: false })}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.acceptedDishChange}>Zmień</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.scaleNeedPick}>Kliknij podpowiedź z listy, aby zaakceptować danie.</Text>
      )}
      {accepted ? (
        <EditRow
          label="Wstępna liczba porcji (możesz zmienić w kalkulatorze)"
          value={edited.portions == null ? '' : String(edited.portions)}
          onChangeText={(v) => patch({ portions: numOrNull(v) })}
          keyboardType="decimal-pad"
          placeholder="np. 10"
          testID="voice-scale-portions-preview"
        />
      ) : null}
    </Card>
  );
}
