import React from 'react';
import { View, Text } from 'react-native';
import { Zap, WifiOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { getPosProvider, type PosProviderId } from '@/lib/posProviders';
import { settingsInstrStyles as instrStyles } from '@/components/settings/settingsScreenStyles';

/** Kroki podpięcia wybranego POS — baner nad formularzem w Ustawieniach. */
export function PosInstructionBanner({ providerId }: { providerId: PosProviderId }) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const provider = getPosProvider(providerId);
  const steps = provider.steps;

  return (
    <View style={{ gap: 12, marginBottom: 12 }}>
      <View
        style={[
          instrStyles.container,
          { marginBottom: 0 },
          prem && {
            backgroundColor: theme.accentSoft,
            borderColor: theme.border,
          },
        ]}
      >
        <View style={instrStyles.titleRow}>
          <Zap size={15} color={theme.accent} strokeWidth={2.5} />
          <Text style={[instrStyles.title, { color: prem ? theme.accent : Colors.accentDark }]}>
            Jak połączyć {provider.name} z Gastro-Manager?
          </Text>
        </View>
        <Text style={[instrStyles.panelHint, { color: prem ? theme.textMuted : '#3B82F6' }]}>
          {provider.panelHint}
        </Text>
        {steps.map((step, idx) => (
          <View key={idx} style={instrStyles.stepRow}>
            <View style={[instrStyles.stepBadge, { backgroundColor: theme.accent }]}>
              <Text style={[instrStyles.stepNum, prem && { color: '#0A0A0A' }]}>{idx + 1}</Text>
            </View>
            <Text style={[instrStyles.stepText, { color: prem ? theme.textSecondary : '#1E3A8A' }]}>
              {step}
            </Text>
          </View>
        ))}
      </View>

      <View
        style={[
          instrStyles.container,
          { marginBottom: 0 },
          prem && {
            backgroundColor: theme.accentSoft,
            borderColor: theme.border,
          },
        ]}
      >
        <View style={instrStyles.titleRow}>
          <WifiOff size={15} color={theme.accent} strokeWidth={2.5} />
          <Text style={[instrStyles.title, { color: prem ? theme.accent : Colors.accentDark }]}>
            Co gdy zniknie internet?
          </Text>
        </View>
        <Text style={[instrStyles.stepText, { color: prem ? theme.textSecondary : '#1E3A8A', marginBottom: 8 }]}>
          Nic nie wpisujesz drugi raz. Nic nie przepisujesz z kartki do Gastro-Managera.
        </Text>
        <Text style={[instrStyles.stepText, { color: prem ? theme.textSecondary : '#1E3A8A', marginBottom: 8 }]}>
          W normalnym POS (GoPOS, Dotykačka, POSbistro i podobne) kelner dalej klika kafelki
          i drukuje paragony bez internetu. Sprzedaż zostaje w kasie. Jak net wróci — POS sam
          dogania swoją chmurę.
        </Text>
        <Text style={[instrStyles.stepText, { color: prem ? theme.textSecondary : '#1E3A8A', marginBottom: 8 }]}>
          Gastro-Manager też dogania się sam: przyjmuje te same sprzedaże jeszcze raz i nie
          odejmuje produktów z magazynu drugi raz. Ty tylko raz wklejasz link webhooka powyżej.
        </Text>
        <Text style={[instrStyles.panelHint, { color: prem ? theme.textMuted : '#3B82F6', marginBottom: 0 }]}>
          Jeśli Twój POS nie umie sam dosłać sprzedaży po awarii netu — poproś serwis POS o
          „ponawianie webhooka / retry”. To robi komputer POS, nie kelner i nie Ty.
        </Text>
      </View>
    </View>
  );
}
