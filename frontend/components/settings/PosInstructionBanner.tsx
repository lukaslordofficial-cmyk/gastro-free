import React from 'react';
import { View, Text } from 'react-native';
import { Zap, WifiOff, Link2, Hash, MapPinned } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { getPosProvider, type PosProviderId } from '@/lib/posProviders';
import { settingsInstrStyles as instrStyles } from '@/components/settings/settingsScreenStyles';

function StepList({
  steps,
  badgeBg,
  prem,
  textColor,
}: {
  steps: string[];
  badgeBg: string;
  prem: boolean;
  textColor: string;
}) {
  return (
    <>
      {steps.map((step, idx) => (
        <View key={idx} style={instrStyles.stepRow}>
          <View style={[instrStyles.stepBadge, { backgroundColor: badgeBg }]}>
            <Text style={[instrStyles.stepNum, prem && { color: '#0A0A0A' }]}>{idx + 1}</Text>
          </View>
          <Text style={[instrStyles.stepText, { color: textColor }]}>{step}</Text>
        </View>
      ))}
    </>
  );
}

/** Kroki podpięcia wybranego POS — baner nad formularzem w Ustawieniach. */
export function PosInstructionBanner({ providerId }: { providerId: PosProviderId }) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const provider = getPosProvider(providerId);
  const cardPrem = prem
    ? { backgroundColor: theme.accentSoft, borderColor: theme.border }
    : null;
  const titleColor = prem ? theme.accent : Colors.accentDark;
  const body = prem ? theme.textSecondary : '#1E3A8A';
  const muted = prem ? theme.textMuted : '#3B82F6';

  return (
    <View style={{ gap: 12, marginBottom: 12 }}>
      <View style={[instrStyles.container, { marginBottom: 0 }, cardPrem]}>
        <View style={instrStyles.titleRow}>
          <Zap size={15} color={theme.accent} strokeWidth={2.5} />
          <Text style={[instrStyles.title, { color: titleColor }]}>
            Jak połączyć {provider.name} z Gastro Manager?
          </Text>
        </View>
        <Text style={[instrStyles.panelHint, { color: muted, marginBottom: 0 }]}>
          {provider.panelHint}
        </Text>
      </View>

      <View style={[instrStyles.container, { marginBottom: 0 }, cardPrem]}>
        <View style={instrStyles.titleRow}>
          <Link2 size={15} color={theme.accent} strokeWidth={2.5} />
          <Text style={[instrStyles.title, { color: titleColor }]}>
            I. Połączenie systemów (Webhook i API Key)
          </Text>
        </View>
        <StepList steps={provider.connectSteps} badgeBg={theme.accent} prem={prem} textColor={body} />
        {provider.tip ? (
          <Text style={[instrStyles.panelHint, { color: muted, marginTop: 8, marginBottom: 0 }]}>
            Wskazówka: {provider.tip}
          </Text>
        ) : null}
      </View>

      <View style={[instrStyles.container, { marginBottom: 0 }, cardPrem]}>
        <View style={instrStyles.titleRow}>
          <Hash size={15} color={theme.accent} strokeWidth={2.5} />
          <Text style={[instrStyles.title, { color: titleColor }]}>
            II. Pobranie kodów dań (SKU) z POS-a
          </Text>
        </View>
        <StepList steps={provider.skuSteps} badgeBg={theme.accent} prem={prem} textColor={body} />
      </View>

      <View style={[instrStyles.container, { marginBottom: 0 }, cardPrem]}>
        <View style={instrStyles.titleRow}>
          <MapPinned size={15} color={theme.accent} strokeWidth={2.5} />
          <Text style={[instrStyles.title, { color: titleColor }]}>III. Parowanie w aplikacji</Text>
        </View>
        <StepList steps={provider.mappingSteps} badgeBg={theme.accent} prem={prem} textColor={body} />
      </View>

      <View style={[instrStyles.container, { marginBottom: 0 }, cardPrem]}>
        <View style={instrStyles.titleRow}>
          <WifiOff size={15} color={theme.accent} strokeWidth={2.5} />
          <Text style={[instrStyles.title, { color: titleColor }]}>Co gdy zniknie internet?</Text>
        </View>
        <Text style={[instrStyles.stepText, { color: body, marginBottom: 0 }]}>
          POS sam powinien dosłać sprzedaż na ten sam link. Jeśli po awarii sprzedaże nie wrócą,
          poproś serwis POS, by włączył ponownie webhooka.
        </Text>
      </View>
    </View>
  );
}
