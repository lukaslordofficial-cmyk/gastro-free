import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Webhook, Copy, Check } from 'lucide-react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { settingsWebhookStyles as whStyles } from '@/components/settings/settingsScreenStyles';

/** Długi URL bez spacji nie zawija się w RN — ZWSP co znak, kopiowanie bez ZWSP. */
function wrapUrlChars(url: string): string {
  return url.split('').join('\u200B');
}

/** Podgląd + kopiowanie podpisanego URL webhooka POS (cały adres, znak po znaku). */
export function WebhookUrlRow({ url }: { url: string }) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(url);
    } catch {
      /* ignore */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View style={whStyles.container}>
      <View style={whStyles.labelRow}>
        <Webhook size={13} color={theme.textSecondary} strokeWidth={2} />
        <Text style={[whStyles.label, { color: theme.textSecondary }]}>Twój Link Webhook</Text>
        <View style={[whStyles.autoBadge, prem && { backgroundColor: theme.accentSoft }]}>
          <Text style={[whStyles.autoBadgeText, prem && { color: theme.accent }]}>AUTO</Text>
        </View>
      </View>
      <View style={[whStyles.urlBlock, prem && { backgroundColor: theme.segmentBg, borderColor: theme.border }]}>
        <Text
          selectable
          style={[
            whStyles.urlTextFull,
            { color: theme.text, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
          ]}
        >
          {wrapUrlChars(url)}
        </Text>
        <TouchableOpacity
          style={[
            whStyles.copyBtn,
            { alignSelf: 'flex-end', marginTop: 10 },
            prem && { backgroundColor: theme.accentSoft, borderColor: theme.accent },
            copied && (prem ? { backgroundColor: theme.accent } : whStyles.copyBtnSuccess),
          ]}
          onPress={() => { void handleCopy(); }}
          activeOpacity={0.75}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {copied
            ? <Check size={14} color={prem ? '#0A0A0A' : '#fff'} strokeWidth={2.5} />
            : <Copy size={14} color={theme.accent} strokeWidth={2} />}
          <Text
            style={[
              whStyles.copyBtnText,
              { color: theme.accent },
              copied && (prem ? { color: '#0A0A0A' } : whStyles.copyBtnTextSuccess),
            ]}
          >
            {copied ? 'Skopiowano!' : 'Kopiuj'}
          </Text>
        </TouchableOpacity>
      </View>
      <Text style={[whStyles.hint, { color: theme.textMuted }]}>
        Cały adres powyżej, znak po znaku (łącznie z tokenem). Przepisujesz ręcznie do POS
        albo tapnij Kopiuj — nie obcinaj linku.
      </Text>
    </View>
  );
}
