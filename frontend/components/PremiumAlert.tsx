/**
 * Dark-premium dialog (zamiast systemowego Alert.alert).
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { Colors } from '@/constants/colors';

type Btn = {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive' | 'primary';
};

type DialogState = {
  visible: boolean;
  title: string;
  message: string;
  buttons: Btn[];
};

type Ctx = {
  alert: (title: string, message?: string, buttons?: Btn[]) => void;
};

const PremiumAlertContext = createContext<Ctx | null>(null);

export function PremiumAlertProvider({ children }: { children: React.ReactNode }) {
  const theme = useAppTheme();
  const [state, setState] = useState<DialogState>({
    visible: false,
    title: '',
    message: '',
    buttons: [{ text: 'OK' }],
  });

  const alert = useCallback((title: string, message?: string, buttons?: Btn[]) => {
    setState({
      visible: true,
      title,
      message: message || '',
      buttons: buttons?.length ? buttons : [{ text: 'OK', style: 'primary' }],
    });
  }, []);

  const close = () => setState((s) => ({ ...s, visible: false }));

  const value = useMemo(() => ({ alert }), [alert]);

  const prem = theme.isPremium;
  const bg = prem ? DS.color.surfaceCard : Colors.card;
  const text = prem ? DS.color.heading : Colors.textPrimary;
  const muted = prem ? DS.color.muted : Colors.textSecondary;
  const border = prem ? DS.color.borderSubtle : Colors.border;
  const accent = prem ? DS.color.greenEnd : Colors.accent;

  return (
    <PremiumAlertContext.Provider value={value}>
      {children}
      <Modal visible={state.visible} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.overlay}>
          <View style={[styles.sheet, { backgroundColor: bg, borderColor: border }]}>
            <Text style={[styles.title, { color: text }]}>{state.title}</Text>
            {!!state.message && (
              <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
                <Text style={[styles.message, { color: muted }]}>{state.message}</Text>
              </ScrollView>
            )}
            <View style={styles.btnRow}>
              {state.buttons.map((b, i) => {
                const primary = b.style === 'primary' || (!b.style && i === state.buttons.length - 1);
                const danger = b.style === 'destructive';
                const cancel = b.style === 'cancel';
                return (
                  <TouchableOpacity
                    key={`${b.text}-${i}`}
                    style={[
                      styles.btn,
                      primary && { backgroundColor: accent },
                      danger && { backgroundColor: Colors.danger },
                      cancel && {
                        backgroundColor: prem ? DS.color.bgTertiary : Colors.borderLight,
                        borderWidth: 1,
                        borderColor: border,
                      },
                      !primary && !danger && !cancel && {
                        backgroundColor: prem ? DS.color.bgTertiary : Colors.borderLight,
                        borderWidth: 1,
                        borderColor: border,
                      },
                    ]}
                    onPress={() => {
                      close();
                      b.onPress?.();
                    }}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        styles.btnText,
                        {
                          color:
                            primary || danger
                              ? prem && primary
                                ? '#0A0A0A'
                                : '#fff'
                              : text,
                        },
                      ]}
                      numberOfLines={2}
                    >
                      {b.text}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </PremiumAlertContext.Provider>
  );
}

export function usePremiumAlert() {
  const ctx = useContext(PremiumAlertContext);
  if (!ctx) {
    return {
      alert: (title: string, message?: string, buttons?: Btn[]) => {
        // fallback
        const { Alert } = require('react-native');
        Alert.alert(title, message, buttons as any);
      },
    };
  }
  return ctx;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  title: { fontSize: 17, fontWeight: '800' },
  message: { fontSize: 13, lineHeight: 19 },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4, justifyContent: 'flex-end' },
  btn: {
    minHeight: 42,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    flexGrow: 1,
    minWidth: 100,
  },
  btnText: { fontSize: 13, fontWeight: '800', textAlign: 'center' },
});
