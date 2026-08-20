import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Clipboard } from 'react-native';
import { Webhook, Copy, Check } from 'lucide-react-native';
import { useAppTheme } from '@/hooks/useAppTheme';
import { settingsWebhookStyles as whStyles } from '@/components/settings/settingsScreenStyles';

/** Podgląd + kopiowanie podpisanego URL webhooka POS. */
export function WebhookUrlRow({ url }: { url: string }) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    Clipboard.setString(url);
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
      <View style={[whStyles.urlRow, prem && { backgroundColor: theme.segmentBg, borderColor: theme.border }]}>
        <Text style={[whStyles.urlText, { color: theme.text }]} numberOfLines={1} ellipsizeMode="middle">
          {url}
        </Text>
        <TouchableOpacity
          style={[
            whStyles.copyBtn,
            prem && { backgroundColor: theme.accentSoft, borderColor: theme.accent },
            copied && (prem ? { backgroundColor: theme.accent } : whStyles.copyBtnSuccess),
          ]}
          onPress={handleCopy}
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
        Ten adres wklej w polu „Webhook URL” w panelu POS (cały link, łącznie z tokenem).
        Kody produktów w Mapowaniu receptur muszą być takie same jak w POS.
      </Text>
    </View>
  );
}
