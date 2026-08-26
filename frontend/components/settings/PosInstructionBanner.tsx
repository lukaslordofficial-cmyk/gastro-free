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
          Wklejasz link webhooka w POS jeden raz. Potem nic nie ustawiasz w Gastro-Managerze,
          gdy padnie internet.
        </Text>
        <Text style={[instrStyles.stepText, { color: prem ? theme.textSecondary : '#1E3A8A', marginBottom: 8 }]}>
          Kelner dalej zbija rachunki na kasie. Gdy net wróci, POS sam powinien dosłać sprzedaże
          na ten sam link — Ty nie klikasz nic drugi raz.
        </Text>
        <Text style={[instrStyles.panelHint, { color: prem ? theme.textMuted : '#3B82F6', marginBottom: 0 }]}>
          Gastro-Manager nie dubluje magazynu, nawet gdy POS wyśle ten sam rachunek ponownie.
          Jeśli po awarii sprzedaży nie wracają — to wina kolejki w POS; poproś serwis kasy,
          żeby włączył ponawianie webhooka. Tego nie robi kelner.
        </Text>
      </View>
    </View>
  );
}
