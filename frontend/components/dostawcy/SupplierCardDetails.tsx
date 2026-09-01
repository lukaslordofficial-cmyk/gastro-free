import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { PenLine, FileText, Trash2, ShoppingCart } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { formatPln } from '@/lib/format';
import { useAppTheme } from '@/hooks/useAppTheme';
import type { Supplier } from './types';
import { cardStyles } from './supplierCardStyles';

type Props = {
  supplier: Supplier;
  displayCategory: string;
  onEdit: () => void;
  onInvoices: () => void;
  onDelete: () => void;
  onOrder: () => void;
};

export function SupplierCardDetails({
  supplier,
  displayCategory,
  onEdit,
  onInvoices,
  onDelete,
  onOrder,
}: Props) {
  const theme = useAppTheme();
  return (
    <>
          {/* Dane + zarządzanie */}
          <View style={cardStyles.details}>
            {/* Edytuj / Usuń — u góry, ponad danymi */}
            <View style={cardStyles.managePanelRow}>
              <TouchableOpacity
                style={[
                  cardStyles.managePanelBtn,
                  theme.isPremium
                    ? { backgroundColor: 'rgba(0,230,118,0.22)', borderWidth: 1, borderColor: DS.color.greenEnd }
                    : { backgroundColor: Colors.accentLight, borderWidth: 1, borderColor: '#BFDBFE' },
                ]}
                onPress={onEdit}
                activeOpacity={0.7}
                testID={`edit-supplier-${supplier.id}`}
              >
                <PenLine size={13} color={theme.isPremium ? DS.color.greenEnd : Colors.accent} strokeWidth={2.4} />
                <Text
                  style={[
                    cardStyles.managePanelBtnText,
                    { color: theme.isPremium ? DS.color.greenEnd : Colors.accent },
                  ]}
                >
                  Edytuj
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  cardStyles.managePanelBtn,
                  theme.isPremium
                    ? { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: DS.color.borderSubtle }
                    : { backgroundColor: Colors.borderLight, borderWidth: 1, borderColor: Colors.border },
                ]}
                onPress={onInvoices}
                activeOpacity={0.7}
                testID={`invoices-supplier-${supplier.id}`}
              >
                <FileText size={13} color={theme.isPremium ? DS.color.heading : Colors.textPrimary} strokeWidth={2.4} />
                <Text
                  style={[
                    cardStyles.managePanelBtnText,
                    { color: theme.isPremium ? DS.color.heading : Colors.textPrimary },
                  ]}
                >
                  Faktury
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  cardStyles.managePanelBtn,
                  theme.isPremium
                    ? { backgroundColor: 'rgba(255,82,82,0.18)', borderWidth: 1, borderColor: DS.color.danger }
                    : { backgroundColor: Colors.dangerLight, borderWidth: 1, borderColor: '#FECACA' },
                ]}
                onPress={onDelete}
                activeOpacity={0.7}
                testID={`delete-supplier-${supplier.id}`}
              >
                <Trash2 size={13} color={theme.isPremium ? DS.color.danger : Colors.danger} strokeWidth={2.4} />
                <Text
                  style={[
                    cardStyles.managePanelBtnText,
                    { color: theme.isPremium ? DS.color.danger : Colors.danger },
                  ]}
                >
                  Usuń
                </Text>
              </TouchableOpacity>
            </View>

            {/* Dane dostawcy — etykiety + wartości */}
            <View
              style={[
                cardStyles.dataBlock,
                theme.isPremium && { backgroundColor: '#000000' },
              ]}
            >
              <View style={cardStyles.dataRow}>
                <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>Nazwa</Text>
                <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                  {supplier.name}
                </Text>
              </View>
              {!!displayCategory && (
                <View style={cardStyles.dataRow}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>Kategoria</Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {displayCategory}
                  </Text>
                </View>
              )}
              {!!supplier.nip && (
                <View style={cardStyles.dataRow}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>NIP</Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {supplier.nip}
                  </Text>
                </View>
              )}
              {!!supplier.contact_person && (
                <View style={cardStyles.dataRow}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>Kontakt</Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {supplier.contact_person}
                  </Text>
                </View>
              )}
              {!!supplier.phone && (
                <View style={cardStyles.dataRow}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>Telefon</Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {supplier.phone}
                  </Text>
                </View>
              )}
              {!!supplier.email && (
                <View style={cardStyles.dataRow}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>E-mail</Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {supplier.email}
                  </Text>
                </View>
              )}
              {!!supplier.address && (
                <View style={cardStyles.dataRow} testID={`supplier-address-${supplier.id}`}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>Adres</Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {supplier.address}
                  </Text>
                </View>
              )}
              {supplier.bank_account ? (
                <View style={cardStyles.dataRow} testID={`supplier-bank-${supplier.id}`}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>Konto</Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {supplier.bank_account}
                  </Text>
                </View>
              ) : (
                <View style={cardStyles.dataRow} testID={`supplier-bank-missing-${supplier.id}`}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>Konto</Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && { color: DS.color.muted }]}>
                    Uzupełnij numer konta (przelew z Łowcy)
                  </Text>
                </View>
              )}
              {!!supplier.notes && (
                <View style={cardStyles.dataRow}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>Notatki</Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {supplier.notes}
                  </Text>
                </View>
              )}
              {supplier.min_order_value > 0 && (
                <View style={cardStyles.dataRow} testID={`min-order-${supplier.id}`}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>
                    Min. zamówienie
                  </Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {formatPln(supplier.min_order_value)}
                  </Text>
                </View>
              )}
              {supplier.shipping_cost > 0 && (
                <View style={cardStyles.dataRow}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>Dostawa</Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {formatPln(supplier.shipping_cost)}
                    {supplier.free_shipping_threshold > 0
                      ? ` · gratis od ${formatPln(supplier.free_shipping_threshold)}`
                      : ''}
                  </Text>
                </View>
              )}
              {supplier.lead_time_days != null && supplier.lead_time_days > 0 ? (
                <View style={cardStyles.dataRow} testID={`lead-time-${supplier.id}`}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>
                    Czas dostawy
                  </Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && cardStyles.dataValuePrem]}>
                    {supplier.lead_time_days === 1
                      ? '1 dzień'
                      : `${supplier.lead_time_days} dni`}
                  </Text>
                </View>
              ) : (
                <View style={cardStyles.dataRow} testID={`lead-time-missing-${supplier.id}`}>
                  <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>
                    Czas dostawy
                  </Text>
                  <Text style={[cardStyles.dataValue, theme.isPremium && { color: DS.color.muted }]}>
                    Uzupełnij czas dostawy
                  </Text>
                </View>
              )}
              <View style={cardStyles.dataRow} testID={`reliability-${supplier.id}`}>
                <Text style={[cardStyles.dataLabel, theme.isPremium && cardStyles.dataLabelPrem]}>
                  Niezawodność
                </Text>
                <Text style={[cardStyles.dataValue, theme.isPremium && { color: DS.color.muted }]}>
                  brak danych / wstępna
                </Text>
              </View>
              <Text
                style={[
                  cardStyles.dataLabel,
                  { marginBottom: 8, fontSize: 11, lineHeight: 15 },
                  theme.isPremium && { color: DS.color.muted },
                ]}
              >
                Score z ocen dostaw pojawi się po wgraniu co najmniej 5 ofert od tego dostawcy.
              </Text>
            </View>

            {/* Złóż zamówienie — pod danymi */}
            <TouchableOpacity
              style={[
                cardStyles.managePanelBtn,
                cardStyles.managePanelBtnFull,
                theme.isPremium
                  ? { backgroundColor: DS.color.greenEnd }
                  : { backgroundColor: Colors.accent },
              ]}
              onPress={onOrder}
              activeOpacity={0.7}
            >
              <ShoppingCart size={15} color={theme.isPremium ? '#0A0A0A' : Colors.white} strokeWidth={2.4} />
              <Text
                style={[
                  cardStyles.managePanelBtnText,
                  { color: theme.isPremium ? '#0A0A0A' : Colors.white, fontSize: 13 },
                ]}
              >
                Złóż zamówienie
              </Text>
            </TouchableOpacity>
          </View>
    </>
  );
}
