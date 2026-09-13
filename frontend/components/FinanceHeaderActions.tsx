/**
 * Pasek akcji w zakładce Finanse — powiadomienia + samouczek + sterowanie głosem + zgłoś uwagi.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ReportInfoButton } from '@/components/ReportInfoButton';
import { FeedbackButton } from '@/components/FeedbackButton';
import { NotificationsButton } from '@/components/NotificationsButton';
import { TutorialButton } from '@/components/TutorialButton';

type Props = {
  contextHint?: string;
  onApplied?: () => void;
  centered?: boolean;
  darkText?: boolean;
  reportTestID?: string;
  feedbackTestID?: string;
  notificationsTestID?: string;
  tutorialTestID?: string;
};

export function FinanceHeaderActions({
  contextHint = 'Wyniki',
  onApplied,
  centered,
  darkText,
  reportTestID = 'finanse-report-info',
  feedbackTestID = 'finanse-feedback',
  notificationsTestID = 'finanse-notifications',
  tutorialTestID = 'finanse-tutorial',
}: Props) {
  return (
    <View style={[styles.row, centered && styles.rowCentered]}>
      <NotificationsButton centered={centered} darkText={darkText} testID={notificationsTestID} />
      <TutorialButton centered={centered} darkText={darkText} testID={tutorialTestID} />
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
