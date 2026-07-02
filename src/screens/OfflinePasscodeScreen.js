import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  StatusBar, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DB } from '../storage/db';

const C = { navy:'#1F3A5F', blue:'#2E75B6', white:'#fff', muted:'#64748B', red:'#DC2626' };

// Simple shared deterrent for offline mode — there's no server to check a
// real password against while offline, so this just stops a random phone
// (someone outside the company) from opening straight into local data with
// no network. Not real security: it's one shared code, stored/checked
// locally, and once entered correctly this device stays unlocked. Change
// OFFLINE_PASSCODE here to change the code company-wide (requires a new
// app build to take effect).
const OFFLINE_PASSCODE = 'geopacific2026';

export default function OfflinePasscodeScreen({ onUnlock }) {
  const [code,  setCode]  = useState('');
  const [error, setError] = useState('');

  async function submit() {
    if (code.trim() === OFFLINE_PASSCODE) {
      await DB.setOfflineUnlocked();
      onUnlock();
    } else {
      setError('Incorrect code.');
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.navy} />
      <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.content}>
          <Text style={s.title}>GeoTechLogger</Text>
          <Text style={s.subtitle}>No connection — enter the offline access code to continue</Text>
          <TextInput
            style={s.input}
            placeholder="Offline access code"
            placeholderTextColor={C.muted}
            secureTextEntry
            autoCapitalize="none"
            value={code}
            onChangeText={t => { setCode(t); setError(''); }}
            onSubmitEditing={submit}
          />
          {!!error && <Text style={s.error}>{error}</Text>}
          <TouchableOpacity style={s.btn} onPress={submit}>
            <Text style={s.btnTxt}>Continue Offline</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:     { flex:1, backgroundColor:C.navy },
  content:  { flex:1, justifyContent:'center', paddingHorizontal:28 },
  title:    { color:'#fff', fontSize:26, fontWeight:'bold', textAlign:'center', marginBottom:4 },
  subtitle: { color:'rgba(255,255,255,0.7)', fontSize:13, textAlign:'center', marginBottom:28 },
  input:    { backgroundColor:'#fff', borderRadius:10, paddingHorizontal:14, paddingVertical:12,
              fontSize:15, color:'#1E293B', marginBottom:10 },
  error:    { color:'#FCA5A5', fontSize:12, marginBottom:10, textAlign:'center' },
  btn:      { backgroundColor:C.blue, borderRadius:10, paddingVertical:14, alignItems:'center', marginTop:6 },
  btnTxt:   { color:'#fff', fontWeight:'bold', fontSize:15 },
});
