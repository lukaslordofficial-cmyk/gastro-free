import React from 'react';
import { View } from 'react-native';
import { Bell, BookOpen, Box, Mic, Trash2 } from 'lucide-react-native';
import { DS } from '@/constants/premiumTheme';
import {
  PremiumGlowCta,
  PremiumStatTile,
} from '@/components/premium/PremiumUI';

export function MenuListHeader({
  filteredCount,
  categoryCount,
  ingredientCount,
  onOpenRecipes,
  onOpenVoiceReport,
}: {
  filteredCount: number;
  categoryCount: number;
  ingredientCount: number;
  onOpenRecipes: () => void;
  onOpenVoiceReport: () => void;
}) {
  return (
    <View style={{ marginTop: 10, marginBottom: DS.space[16], gap: 10 }}>
      <PremiumGlowCta
        label="Receptury"
        onPress={onOpenRecipes}
        icon={<BookOpen size={16} color="#0A0A0A" strokeWidth={2.5} />}
      />
      <PremiumGlowCta
        label="Zgłoś informację"
        onPress={onOpenVoiceReport}
        icon={<Mic size={16} color="#0A0A0A" strokeWidth={2.5} />}
      />
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
        <PremiumStatTile
          value={filteredCount}
          label="Dań"
          icon={<Bell size={14} color={DS.color.greenEnd} strokeWidth={2} />}
        />
        <PremiumStatTile
          value={categoryCount}
          label="Kategorii"
          icon={<Box size={14} color={DS.color.greenEnd} strokeWidth={2} />}
        />
        <PremiumStatTile
          value={ingredientCount}
          label="Składników"
          icon={<Trash2 size={14} color={DS.color.greenEnd} strokeWidth={2} />}
        />
      </View>
    </View>
  );
}
