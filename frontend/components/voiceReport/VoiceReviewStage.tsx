import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { AlertTriangle, RefreshCw, Send, Trash2, ShieldAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { JarvisSuggestBox } from '@/components/JarvisFormExtras';
import type { Intent, Interpretation } from './types';
import { CONFIRM_WORD, INTENT_META, PERIOD_INTENTS, UPLOAD_INTENTS } from './constants';
import { IntentEditor } from './IntentEditor';
import { styles } from './styles';

export function VoiceReviewStage({
  transcript,
  interp,
  meta,
  needsIntentClarify,
  clarifyQuery,
  onClarifyQueryChange,
  clarifySuggestions,
  onApplyClarifiedIntent,
  isDestructive,
  confirmText,
  onConfirmTextChange,
  edited,
  patchEdited,
  categories,
  menuCategories,
  canApply,
  onResetAll,
  onApply,
}: {
  transcript: string;
  interp: Interpretation;
  meta: { icon: string; label: string; color: string };
  needsIntentClarify: boolean;
  clarifyQuery: string;
  onClarifyQueryChange: (q: string) => void;
  clarifySuggestions: { id: string; name: string; hint?: string; intent: Intent }[];
  onApplyClarifiedIntent: (intent: Intent) => void;
  isDestructive: boolean;
  confirmText: string;
  onConfirmTextChange: (t: string) => void;
  edited: Record<string, any>;
  patchEdited: (patch: Record<string, any>) => void;
  categories: { id: string; name: string; color: string }[];
  menuCategories: string[];
  canApply: boolean;
  onResetAll: () => void;
  onApply: () => void;
}) {
  return (
    <View>
      <View style={styles.transcriptBox}>
        <Text style={styles.transcriptLabel}>Rozpoznany tekst</Text>
        <Text style={styles.transcriptText}>{transcript}</Text>
      </View>

      <Text style={styles.sectionLabel}>Intencja AI</Text>
      <View style={[styles.intentBadge, { backgroundColor: `${meta.color}18`, borderColor: `${meta.color}55` }]}>
        <Text style={styles.intentBadgeIcon}>{meta.icon}</Text>
        <Text style={[styles.intentBadgeText, { color: meta.color }]}>{meta.label}</Text>
        <Text style={styles.intentBadgeConf}>{Math.round((interp.confidence ?? 0) * 100)}%</Text>
      </View>

      {interp.reason ? (
        <Text style={styles.intentReason}>{interp.reason}</Text>
      ) : null}

      {Array.isArray(interp.alternate_intents) && interp.alternate_intents.length >= 2 ? (
        <View style={styles.altIntentsBox} testID="voice-alt-intents">
          <Text style={styles.periodConfirmWarn}>Jarvis nie jest pewien — wybierz:</Text>
          {interp.alternate_intents.slice(0, 2).map((alt) => (
            <TouchableOpacity
              key={alt.intent}
              style={[
                styles.altIntentBtn,
                interp.intent === alt.intent && styles.altIntentBtnOn,
              ]}
              onPress={() => onApplyClarifiedIntent(alt.intent as Intent)}
              activeOpacity={0.85}
            >
              <Text style={[styles.altIntentText, interp.intent === alt.intent && { color: '#0A0A0A' }]}>
                {alt.label}
              </Text>
            </TouchableOpacity>
          ))}
          <Text style={styles.clarifyHint}>Albo wpisz, co chcesz zrobić:</Text>
          <JarvisSuggestBox
            query={clarifyQuery}
            onChangeQuery={onClarifyQueryChange}
            suggestions={clarifySuggestions}
            onPick={(s) => {
              const intent = (s.id || '') as Intent;
              if (intent && INTENT_META[intent]) onApplyClarifiedIntent(intent);
            }}
            placeholder="np. dodaj przychód, koszt stały…"
            testID="voice-clarify-input"
          />
        </View>
      ) : needsIntentClarify ? (
        <View style={styles.altIntentsBox} testID="voice-clarify-box">
          <Text style={styles.periodConfirmWarn}>
            {interp.intent === 'unknown'
              ? 'Nie rozpoznano komendy — wpisz, co chcesz zrobić:'
              : 'Jarvis nie jest pewien — doprecyzuj wpisując komendę:'}
          </Text>
          <JarvisSuggestBox
            query={clarifyQuery}
            onChangeQuery={onClarifyQueryChange}
            suggestions={clarifySuggestions}
            onPick={(s) => {
              const intent = (s.id || '') as Intent;
              if (intent && INTENT_META[intent]) onApplyClarifiedIntent(intent);
            }}
            placeholder="np. dodaj przychód, koszt stały…"
            testID="voice-clarify-input"
          />
        </View>
      ) : null}

      {interp.intent !== 'unknown' && !isDestructive && (
        <Text style={styles.editHint}>
          Sprawdź i popraw dane przed zapisem — możesz edytować każde pole.
        </Text>
      )}

      {isDestructive && (
        <View style={styles.dangerBox} testID="voice-danger-box">
          <View style={styles.dangerHeader}>
            <ShieldAlert size={20} color="#FFFFFF" strokeWidth={2.5} />
            <Text style={styles.dangerTitle}>⚠️ Uwaga! Operacja nieodwracalna</Text>
          </View>
          <Text style={styles.dangerText}>
            Jarvis wykrył intencję masowego usunięcia / resetu danych
            („{meta.label}"). Aby kontynuować, wpisz poniżej słowo{'\n'}
            <Text style={styles.dangerWord}>{CONFIRM_WORD}</Text>.
          </Text>
          <TextInput
            style={styles.dangerInput}
            value={confirmText}
            onChangeText={onConfirmTextChange}
            placeholder={CONFIRM_WORD}
            placeholderTextColor="rgba(255,255,255,0.5)"
            autoCapitalize="characters"
            autoCorrect={false}
            testID="voice-confirm-input"
          />
        </View>
      )}

      {!isDestructive && (
        <IntentEditor
          intent={interp.intent}
          edited={edited}
          patch={patchEdited}
          categories={categories}
          menuCategories={menuCategories}
        />
      )}

      {interp.intent === 'unknown' && !needsIntentClarify && (
        <View style={styles.errorBox}>
          <AlertTriangle size={14} color={Colors.danger} strokeWidth={2.5} />
          <Text style={styles.errorText}>
            AI nie rozpoznało jednoznacznej intencji. Nagraj ponownie
            z konkretnymi słowami: „wyrzuciłem", „dodaj do menu",
            „rachunek za…", „nowy dostawca…".
          </Text>
        </View>
      )}

      {interp.intent === 'unknown' && needsIntentClarify ? (
        <Text style={styles.editHint}>
          Wybierz podpowiedź powyżej albo nagraj jeszcze raz z jaśniejszą komendą.
        </Text>
      ) : null}

      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.secondaryBtn} onPress={onResetAll} activeOpacity={0.85} testID="voice-review-retry">
          <RefreshCw size={14} color={DS.color.muted} strokeWidth={2.5} />
          <Text style={styles.secondaryBtnText} numberOfLines={2}>Nagraj jeszcze raz</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            isDestructive && styles.dangerBtn,
            !canApply && styles.primaryBtnDisabled,
          ]}
          onPress={onApply}
          disabled={!canApply}
          activeOpacity={0.85}
          testID="voice-review-apply"
        >
          {isDestructive
            ? <Trash2 size={14} color={Colors.white} strokeWidth={2.5} />
            : <Send size={14} color="#0A0A0A" strokeWidth={2.5} />}
          <Text style={[styles.primaryBtnText, isDestructive && { color: Colors.white }]} numberOfLines={2}>
            {isDestructive ? 'Usuń bezpowrotnie'
              : interp.intent === 'restore_last_deleted_menu' ? 'Przywróć menu'
              : interp.intent === 'restore_deleted_inventory' ? 'Przywróć magazyn'
              : interp.intent === 'scale_recipe' ? 'Otwórz kalkulator'
              : interp.intent === 'toggle_menu_item_availability'
                ? (edited.available === true ? 'Włącz danie' : 'Wyłącz danie')
              : PERIOD_INTENTS.has(interp.intent) ? 'Analizuj'
              : (interp.intent === 'order_product' || interp.intent === 'order_critical_items_by_category')
                ? 'Zamów'
              : UPLOAD_INTENTS.has(interp.intent)
                ? (interp.intent === 'upload_offer' ? 'Wgraj ofertę' : interp.intent === 'upload_document' ? 'Wgraj dokument' : 'Wgraj fakturę')
              : 'Zapisz'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
