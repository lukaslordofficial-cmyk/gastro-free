import React from 'react';
import { View, Text } from 'react-native';
import { FileText, Info, Zap, CircleAlert } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import type { SupplierOffer, SupplierOfferItem } from '@/lib/types';
import { OfferStatusBadge } from './OfferStatusBadge';
import { cardStyles } from './supplierCardStyles';

type Props = {
  offer: SupplierOffer | null;
  visibleItems: SupplierOfferItem[];
  hiddenItems: SupplierOfferItem[];
  totalAnalysesUsed: number;
};

export function SupplierCardOfferSection({
  offer,
  visibleItems,
  hiddenItems,
  totalAnalysesUsed,
}: Props) {
  const theme = useAppTheme();
  return (
          <View
            style={[
              cardStyles.pdfSection,
              theme.isPremium && {
                backgroundColor: DS.color.bgTertiary,
                borderTopColor: DS.color.borderSubtle,
              },
            ]}
          >
            <View style={cardStyles.pdfSectionHeader}>
              <FileText size={13} color={theme.isPremium ? DS.color.greenEnd : Colors.textSecondary} strokeWidth={2} />
              <Text style={[cardStyles.pdfSectionTitle, theme.isPremium && { color: DS.color.heading }]}>Oferta AI — Cennik</Text>
              {offer && <OfferStatusBadge status={offer.status} />}
            </View>

            {offer && (
              <View style={cardStyles.pdfInfo}>
                <Text style={cardStyles.pdfFileName} numberOfLines={1}>{offer.file_name}</Text>

                {offer.status === 'done' && (
                  <>
                    <View style={cardStyles.resultRow}>
                      <View style={cardStyles.resultStat}>
                        <Text style={cardStyles.resultStatNum}>{offer.parsed_count}</Text>
                        <Text style={cardStyles.resultStatLabel}>znaleziono</Text>
                      </View>
                      <View style={cardStyles.resultDivider} />
                      <View style={cardStyles.resultStat}>
                        <Text style={[cardStyles.resultStatNum, visibleItems.length === 0 && cardStyles.resultStatNumZero]}>
                          {visibleItems.length}
                        </Text>
                        <Text style={cardStyles.resultStatLabel}>pasuje do magazynu</Text>
                      </View>
                      <View style={cardStyles.resultDivider} />
                      <View style={cardStyles.resultStat}>
                        <Text style={cardStyles.resultStatNum}>{hiddenItems.length}</Text>
                        <Text style={cardStyles.resultStatLabel}>bez dopasowania</Text>
                      </View>
                    </View>

                    {visibleItems.length === 0 && offer.parsed_count > 0 && (
                      <View style={cardStyles.noMatchBox}>
                        <Info size={13} color={Colors.warning} strokeWidth={2} />
                        <Text style={cardStyles.noMatchText}>
                          Żaden produkt z tej oferty nie pasuje jeszcze do Twojego magazynu.
                          Dodaj produkty do magazynu — system automatycznie je odblokuje.
                        </Text>
                      </View>
                    )}

                    <View style={cardStyles.analysisRow}>
                      <Zap size={11} color={Colors.textTertiary} strokeWidth={2} />
                      <Text style={cardStyles.analysisText}>
                        Zużyto 1 analizę z Twojego planu · łącznie {totalAnalysesUsed}
                      </Text>
                    </View>
                  </>
                )}

                {offer.status === 'error' && offer.error_message && (
                  <View style={cardStyles.errorBox}>
                    <CircleAlert size={13} color={Colors.danger} strokeWidth={2} />
                    <Text style={cardStyles.errorBoxText}>{offer.error_message}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
  );
}
