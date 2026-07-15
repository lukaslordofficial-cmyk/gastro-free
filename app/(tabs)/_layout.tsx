import { Tabs } from 'expo-router';
import { TrendingUp, Package, UtensilsCrossed, Truck, Settings as SettingsIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Platform, StyleSheet } from 'react-native';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.tabActive,
        tabBarInactiveTintColor: Colors.tabInactive,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Finanse',
          tabBarIcon: ({ color, size }) => (
            <TrendingUp size={size} color={color} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Screen
        name="magazyn"
        options={{
          title: 'Magazyn',
          tabBarIcon: ({ color, size }) => (
            <Package size={size} color={color} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: 'Menu',
          tabBarIcon: ({ color, size }) => (
            <UtensilsCrossed size={size} color={color} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Screen
        name="dostawcy"
        options={{
          title: 'Dostawcy',
          tabBarIcon: ({ color, size }) => (
            <Truck size={size} color={color} strokeWidth={2} />
          ),
        }}
      />
      <Tabs.Screen
        name="ustawienia"
        options={{
          title: 'Ustawienia',
          tabBarIcon: ({ color, size }) => (
            <SettingsIcon size={size} color={color} strokeWidth={2} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.tabBackground,
    borderTopColor: Colors.border,
    borderTopWidth: 1,
    height: Platform.OS === 'ios' ? 84 : 64,
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    paddingTop: 8,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 8,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  tabItem: {
    gap: 2,
  },
});
