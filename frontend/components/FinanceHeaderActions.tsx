/**
 * Pasek akcji w zakładce Finanse — powiadomienia + zgłoś informację.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ReportInfoButton } from '@/components/ReportInfoButton';
import { NotificationsButton } from '@/components/NotificationsButton';

type Props = {
  contextHint?: string;
  onApplied?: () => void;
  centered?: boolean;
  darkText?: boolean;
  reportTestID?: string;
  notificationsTestID?: string;
};

export function FinanceHeaderActions({
  contextHint = 'Finanse',
  onApplied,
  centered,
  darkText,
  reportTestID = 'finanse-report-info',
  notificationsTestID = 'finanse-notifications',
}: Props) {
  return (
    <View style={[styles.row, centered && styles.rowCentered]}>
      <NotificationsButton centered={centered} darkText={darkText} testID={notificationsTestID} />
      <ReportInfoButton
        contextHint={contextHint}
        onApplied={onApplied}
        centered={centered}
        darkText={darkText}
        testID={reportTestID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    alignSelf: 'stretch',
  },
  rowCentered: { alignSelf: 'center' },
});
