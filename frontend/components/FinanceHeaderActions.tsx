/**
 * Pasek akcji w zakładce Finanse — powiadomienia + sterowanie głosem + zgłoś uwagi.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ReportInfoButton } from '@/components/ReportInfoButton';
import { FeedbackButton } from '@/components/FeedbackButton';
import { NotificationsButton } from '@/components/NotificationsButton';

type Props = {
  contextHint?: string;
  onApplied?: () => void;
  centered?: boolean;
  darkText?: boolean;
  reportTestID?: string;
  feedbackTestID?: string;
  notificationsTestID?: string;
};

export function FinanceHeaderActions({
  contextHint = 'Finanse',
  onApplied,
  centered,
  darkText,
  reportTestID = 'finanse-report-info',
  feedbackTestID = 'finanse-feedback',
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
      <FeedbackButton
        centered={centered}
        darkText={darkText}
        testID={feedbackTestID}
        defaultLocation={contextHint || 'Finanse'}
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
    flexWrap: 'wrap',
  },
  rowCentered: { alignSelf: 'center' },
});
