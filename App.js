import React, { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Animated, SafeAreaView, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import Home from './screens/Home';
import Chat from './screens/Chat';
import History from './screens/History';
import Profile from './screens/Profile';

const TABS = [
  { key: 'Home', label: 'Home', icon: '⌂' },
  { key: 'Chat', label: 'Chat', icon: '💬' },
  { key: 'History', label: 'History', icon: '🕐' },
  { key: 'Profile', label: 'Profile', icon: '👤' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('Home');
  const [transitioning, setTransitioning] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;
  const translate = useRef(new Animated.Value(0)).current;
  const scaleValues = useRef(
    TABS.reduce((acc, tab) => {
      acc[tab.key] = new Animated.Value(tab.key === 'Home' ? 1.1 : 1);
      return acc;
    }, {})
  ).current;

  const animateTab = (selected) => {
    const animations = TABS.map((tab) =>
      Animated.spring(scaleValues[tab.key], {
        toValue: tab.key === selected ? 1.1 : 1,
        friction: 8,
        tension: 120,
        useNativeDriver: true,
      })
    );
    Animated.parallel(animations).start();
  };

  useEffect(() => {
    if (transitioning) return;
    setTransitioning(true);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(translate, { toValue: 25, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      opacity.setValue(0);
      translate.setValue(-25);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }),
        Animated.timing(translate, { toValue: 0, duration: 260, useNativeDriver: true }),
      ]).start(() => setTransitioning(false));
    });
  }, [activeTab]);

  const renderBody = () => {
    switch (activeTab) {
      case 'Home':
        return <Home onStart={() => setActiveTab('Chat')} />;
      case 'Chat':
        return <Chat />;
      case 'History':
        return <History />;
      case 'Profile':
        return <Profile />;
      default:
        return <Home onStart={() => setActiveTab('Chat')} />;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" backgroundColor="transparent" translucent={Platform.OS === 'android'} />
      <Animated.View style={[styles.content, { opacity, transform: [{ translateX: translate }] }]}>
        {renderBody()}
      </Animated.View>

      <View style={styles.tabBar}>
        {TABS.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <TouchableOpacity
              key={tab.key}
              style={styles.tabItem}
              activeOpacity={0.7}
              onPress={() => {
                setActiveTab(tab.key);
                animateTab(tab.key);
              }}
            >
              <Animated.Text
                style={[
                  styles.tabIcon,
                  { transform: [{ scale: scaleValues[tab.key] }] },
                  active ? styles.tabActive : styles.tabInactive,
                ]}
              >
                {tab.icon}
              </Animated.Text>
              <Animated.Text
                style={[
                  styles.tabLabel,
                  active ? styles.tabLabelActive : styles.tabLabelInactive,
                  { transform: [{ scale: scaleValues[tab.key] }] },
                ]}
              >
                {tab.label}
              </Animated.Text>
              <View style={[styles.tabIndicator, active && styles.tabIndicatorActive]} />
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0F' },
  content: { flex: 1 },
  tabBar: {
    height: 70,
    borderTopColor: '#2A2A4A',
    borderTopWidth: 1,
    backgroundColor: '#1A1A2E',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  tabItem: { alignItems: 'center', width: '25%', paddingVertical: 8 },
  tabIcon: { fontSize: 20, marginBottom: 2 },
  tabLabel: { fontSize: 11, fontWeight: '700' },
  tabActive: { color: '#6C63FF' },
  tabInactive: { color: '#555577' },
  tabLabelActive: { color: '#6C63FF' },
  tabLabelInactive: { color: '#555577' },
  tabIndicator: { width: 6, height: 6, borderRadius: 3, marginTop: 4, backgroundColor: 'transparent' },
  tabIndicatorActive: { backgroundColor: '#6C63FF' },
});

