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

import type { EditRowProps } from './types';
import { UNIT_OPTIONS } from './constants';
import { styles } from './styles';

export function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.reviewCard} testID="voice-review-card">{children}</View>;
}

export function FieldLabel({ text }: { text: string }) {
  return <Text style={styles.editLabel}>{text}</Text>;
}

export function EditRow({ label, value, onChangeText, placeholder, keyboardType, multiline, testID, hint }: EditRowProps) {
  return (
    <View style={styles.editRow}>
      <FieldLabel text={label} />
      <TextInput
        style={[styles.editInput, multiline && styles.editInputMulti]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textTertiary}
        keyboardType={keyboardType ?? 'default'}
        multiline={!!multiline}
        testID={testID}
      />
      {hint ? <Text style={styles.editHint2}>{hint}</Text> : null}
    </View>
  );
}

export function UnitField({ value, onChange, options }: { value: string; onChange: (v: string) => void; options?: string[] }) {
  const units = options ?? UNIT_OPTIONS;
  return (
    <View style={styles.editRow}>
      <FieldLabel text="Jednostka" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
        {units.map((u) => {
          const active = value === u;
          return (
            <TouchableOpacity
              key={u}
              style={[styles.unitPill, active && styles.unitPillActive]}
              onPress={() => onChange(u)}
              activeOpacity={0.7}
              testID={`voice-edit-unit-${u}`}
            >
              <Text style={[styles.unitPillText, active && styles.unitPillTextActive]}>{u}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function SegmentedField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { key: string; label: string }[];
}) {
  return (
    <View style={styles.editRow}>
      <FieldLabel text={label} />
      <View style={styles.segmentRow}>
        {options.map((opt) => {
          const active = value === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[styles.segmentBtn, active && styles.segmentBtnActive]}
              onPress={() => onChange(opt.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
