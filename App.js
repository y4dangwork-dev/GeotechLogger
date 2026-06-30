import 'react-native-gesture-handler';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import HomeScreen     from './src/screens/HomeScreen';
import JobScreen      from './src/screens/JobScreen';
import BoreholeScreen from './src/screens/BoreholeScreen';
import EntryScreen    from './src/screens/EntryScreen';

const Stack = createStackNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Home"     component={HomeScreen} />
          <Stack.Screen name="Job"      component={JobScreen} />
          <Stack.Screen name="Borehole" component={BoreholeScreen} />
          <Stack.Screen name="Entry"    component={EntryScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
