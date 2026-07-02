import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { supabase } from './src/lib/supabaseClient';
import LoginScreen           from './src/screens/LoginScreen';
import OfflinePasscodeScreen from './src/screens/OfflinePasscodeScreen';
import HomeScreen     from './src/screens/HomeScreen';
import JobScreen      from './src/screens/JobScreen';
import BoreholeScreen from './src/screens/BoreholeScreen';
import EntryScreen    from './src/screens/EntryScreen';

const Stack = createStackNavigator();

// Domain verified in Resend — email delivery works, login gate is back on.
const REQUIRE_LOGIN = true;

export default function App() {
  const [session,           setSession]           = useState(undefined); // undefined = still checking, null = signed out
  const [checking,          setChecking]          = useState(REQUIRE_LOGIN);
  // No automatic network probing — that had a real edge case (a paused free
  // Supabase project still answers requests, just with an error, so "can we
  // reach it" doesn't reliably mean "can we actually log in"). Simpler and
  // more predictable: always show the login screen when there's no session,
  // and let the person tap "Continue Offline" themselves if they know they
  // have no signal / Supabase is down. That request is still gated by the
  // shared offline passcode.
  const [wantsOffline,      setWantsOffline]      = useState(false);
  const [offlineUnlocked,   setOfflineUnlocked]   = useState(false);

  useEffect(() => {
    if (!REQUIRE_LOGIN) return;

    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session || null);
      setChecking(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) setWantsOffline(false);
    });

    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  if (checking) {
    // Still restoring a persisted session — avoid a login-screen flash.
    return (
      <View style={{ flex:1, alignItems:'center', justifyContent:'center', backgroundColor:'#1F3A5F' }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  const needsOfflinePasscode = !REQUIRE_LOGIN ? false : (!session && wantsOffline && !offlineUnlocked);
  const signedIn = !REQUIRE_LOGIN || !!session || (wantsOffline && offlineUnlocked);

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        {needsOfflinePasscode ? (
          <OfflinePasscodeScreen onUnlock={() => setOfflineUnlocked(true)} />
        ) : !signedIn ? (
          <LoginScreen onOfflinePress={() => setWantsOffline(true)} />
        ) : (
          <>
            {!session && (
              <View style={{ backgroundColor:'#92400E', paddingVertical:6, alignItems:'center' }}>
                <Text style={{ color:'#fff', fontSize:12, fontWeight:'600' }}>
                  📡 Offline mode — showing local data only. Sign in once you have a connection.
                </Text>
              </View>
            )}
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Home"     component={HomeScreen} />
              <Stack.Screen name="Job"      component={JobScreen} />
              <Stack.Screen name="Borehole" component={BoreholeScreen} />
              <Stack.Screen name="Entry"    component={EntryScreen} />
            </Stack.Navigator>
          </>
        )}
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
