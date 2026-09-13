/**
 * Samouczek po rejestracji / z przycisku na Wynikach — 6 slajdów w stylu premium.
 */
import React, { useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { X, ChefHat, ShoppingBag, Package, Truck, Mic } from 'lucide-react-native';
import { DS } from '@/constants/premiumTheme';

export const TUTORIAL_SLIDE_COUNT = 6;

type Props = {
  visible: boolean;
  slide: number;
  onClose: () => void;
  onNext: () => void;
  onBack: () => void;
  onAddMenu: () => void;
};

type SlideDef = {
  icon: React.ReactNode;
  title: string;
  body: string;
  /** Główny CTA po prawej / jako jedyny na slajdach bez „Dodaj menu”. */
  cta: 'dalej' | 'zamknij';
  /** Slajd menu: dodatkowy przycisk skanu. */
  showAddMenu?: boolean;
};

export function OnboardingTutorialModal({
  visible,
  slide,
  onClose,
  onNext,
  onBack,
  onAddMenu,
}: Props) {
  const slides: SlideDef[] = useMemo(
    () => [
      {
        icon: <ChefHat size={36} color={DS.color.greenMid} strokeWidth={2} />,
        title: 'Cieszymy się, że do nas dołączyłeś',
        body:
          'Gastro Manager pomaga prowadzić restaurację od menu przez magazyn i sprzedaż, aż po zamówienia u dostawców. '
          + 'Przejrzyj samouczek, wykonaj polecenia i zacznij korzystać z dobrodziejstw automatyzacji AI. '
          + 'Jeśli chcesz powrócić do samouczka, możesz zrobić to w każdej chwili. Zajrzyj do zakładki Wyniki.',
        cta: 'dalej',
      },
      {
        icon: <ChefHat size={36} color={DS.color.greenMid} strokeWidth={2} />,
        title: 'Zacznij od menu',
        body:
          'Zeskanuj kartę dań: zrób zdjęcie lub wgraj PDF. Potem uzupełnij składniki i gramatury.\n\n'
          + 'Na ich podstawie przy sprzedaży AI będzie odejmować produkty z magazynu.',
        cta: 'dalej',
        showAddMenu: true,
      },
      {
        icon: <ShoppingBag size={36} color={DS.color.greenMid} strokeWidth={2} />,
        title: 'Sprzedaż',
        body:
          'Aby aplikacja odejmowała produkty z magazynu i dodawała przychody, potrzebuje danych o sprzedaży. '
          + 'Można je dostarczyć na dwa sposoby: automatyczny — jeśli posiadasz system POS i przejdziesz przez proces integracji, '
          + 'ręczny — skanowanie dobowej sprzedaży z ręcznych zapisków, jeśli nie posiadasz POS '
          + '(szablony dokumentów znajdziesz w ustawieniach). '
          + 'Więcej informacji na temat integracji znajdziesz w zakładce Ustawienia.',
        cta: 'dalej',
      },
      {
        icon: <Package size={36} color={DS.color.greenMid} strokeWidth={2} />,
        title: 'Magazyn',
        body:
          'Po skanie menu w Magazynie pojawią się propozycje produktów ze stanem 0. Ustaw stany zgodne z rzeczywistością — kliknij produkt, by go edytować.\n\n'
          + 'Próg krytyczny — przy tej ilości aplikacja powiadomi, że produkt się kończy.\n\n'
          + 'Bufor bezpieczeństwa — margines na niezgłoszone straty. Np. bufor 20% przy progu 10 kg oznacza alert już przy 12 kg.\n\n'
          + 'Próg optymalny — docelowa ilość, do której agent zakupowy będzie zamawiał u dostawców.\n\n'
          + 'Data ważności — wpisz terminy, jeśli chcesz alerty o zbliżającej się przydatności.',
        cta: 'dalej',
      },
      {
        icon: <Truck size={36} color={DS.color.greenMid} strokeWidth={2} />,
        title: 'Dostawcy',
        body:
          'Wgraj oferty dostawców (PDF lub zdjęcie). Aplikacja utworzy profil hurtownika oraz produkty z cenami i jednostkami.\n\n'
          + 'Koszyki zakupowe budują się na tych danych. Dla każdego koszyka AI przygotuje szablon wiadomości — wyślesz go z asystent.dostaw@gastromanager.org albo z własnego maila.',
        cta: 'dalej',
      },
      {
        icon: <Mic size={36} color={DS.color.greenMid} strokeWidth={2} />,
        title: 'Sterowanie głosem',
        body:
          'Wszelkie komendy możesz wydawać głosowo. Kliknij Sterowanie głosem i powiedz, co chcesz zrobić.\n\n'
          + 'Przycisk Komendy głosowe pokazuje listę dostępnych komend.',
        cta: 'zamknij',
      },
    ],
    [],
  );

  const idx = Math.max(0, Math.min(slide, slides.length - 1));
  const current = slides[idx];
  const canGoBack = idx > 0;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <LinearGradient
          colors={['#0A120E', DS.color.bgPrimary, '#050505']}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.topBar}>
            <Text style={styles.brand}>Samouczek</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={styles.closeBtn}
              testID="tutorial-close"
              accessibilityLabel="Zamknij samouczek"
            >
              <X size={22} color={DS.color.heading} strokeWidth={2.5} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <View style={styles.iconWrap}>{current.icon}</View>
            <Text style={styles.title}>{current.title}</Text>
            <Text style={styles.body}>{current.body}</Text>
            <View style={styles.dots}>
              {slides.map((_, i) => (
                <View key={i} style={[styles.dot, i === idx && styles.dotActive]} />
              ))}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            {current.showAddMenu ? (
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={onAddMenu}
                activeOpacity={0.88}
                testID="tutorial-add-menu"
              >
                <LinearGradient
                  colors={[DS.color.greenStart, DS.color.greenMid]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={styles.primaryGrad}
                >
                  <Text style={styles.primaryText}>Dodaj menu</Text>
                </LinearGradient>
              </TouchableOpacity>
            ) : null}

            <View style={styles.navRow}>
              {canGoBack ? (
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={onBack}
                  activeOpacity={0.88}
                  testID="tutorial-back"
                >
                  <Text style={styles.secondaryText}>Wstecz</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.secondaryPlaceholder} />
              )}

              {current.cta === 'zamknij' ? (
                <TouchableOpacity
                  style={[styles.primaryBtn, styles.navPrimary]}
                  onPress={onClose}
                  activeOpacity={0.88}
                  testID="tutorial-finish"
                >
                  <LinearGradient
                    colors={[DS.color.greenStart, DS.color.greenMid]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={styles.primaryGrad}
                  >
                    <Text style={styles.primaryText}>Zakończ</Text>
                  </LinearGradient>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.primaryBtn, styles.navPrimary]}
                  onPress={onNext}
                  activeOpacity={0.88}
                  testID="tutorial-next"
                >
                  <LinearGradient
                    colors={[DS.color.greenStart, DS.color.greenMid]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={styles.primaryGrad}
                  >
                    <Text style={styles.primaryText}>Dalej</Text>
                  </LinearGradient>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  brand: {
    ...DS.type.caption,
    color: DS.color.muted,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 16,
    flexGrow: 1,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: DS.color.greenGlow,
    borderWidth: 1,
    borderColor: 'rgba(0,216,107,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    ...DS.type.h1,
    color: DS.color.heading,
    marginBottom: 14,
  },
  body: {
    ...DS.type.body,
    color: DS.color.body,
    lineHeight: 22,
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 28,
    justifyContent: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  dotActive: {
    width: 22,
    backgroundColor: DS.color.greenMid,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 12,
    paddingTop: 8,
    gap: 10,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: DS.radius.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  secondaryPlaceholder: { flex: 1 },
  secondaryText: {
    color: DS.color.heading,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  primaryBtn: {
    borderRadius: DS.radius.button,
    overflow: 'hidden',
    ...DS.shadow.greenGlow,
  },
  navPrimary: { flex: 1 },
  primaryGrad: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#04140C',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
