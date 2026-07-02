import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, StatusBar, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase, isAllowedEmail } from '../lib/supabaseClient';

const C = { navy:'#1F3A5F', blue:'#2E75B6', bg:'#F8FAFC', white:'#fff',
            border:'#CBD5E1', muted:'#64748B', text:'#1E293B', red:'#DC2626' };

// Two-step passwordless login:
//  1) enter work email -> Supabase emails a 6-digit code
//  2) enter that code -> Supabase verifies it and creates a session
// The @geopacific.ca restriction is enforced by a DB trigger (server-side);
// the check here is just so people get an instant, friendly message instead
// of waiting for a network round trip that's guaranteed to fail.
export default function LoginScreen({ onOfflinePress }) {
  const [step,      setStep]      = useState('email'); // 'email' | 'code'
  const [email,     setEmail]     = useState('');
  const [code,      setCode]      = useState('');
  const [sending,   setSending]   = useState(false);
  const [verifying, setVerifying] = useState(false);

  async function sendCode() {
    const trimmed = email.trim().toLowerCase();
    if (!isAllowedEmail(trimmed)) {
      Alert.alert('Not Allowed', 'Sign-in is restricted to @geopacific.ca email addresses.');
      return;
    }
    setSending(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      setEmail(trimmed);
      setStep('code');
    } catch (e) {
      Alert.alert('Could Not Send Code', e.message || 'Please try again.');
    } finally {
      setSending(false);
    }
  }

  async function verifyCode() {
    if (!code.trim()) { Alert.alert('Required', 'Enter the code from your email.'); return; }
    setVerifying(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email, token: code.trim(), type: 'email',
      });
      if (error) throw error;
      // On success, the auth listener in App.js picks up the new session
      // and swaps the Login screen out automatically.
    } catch (e) {
      Alert.alert('Invalid Code', e.message || 'That code did not work — check and try again.');
    } finally {
      setVerifying(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.navy} />
      <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.content}>
          <Text style={s.title}>GeoTechLogger</Text>
          <Text style={s.subtitle}>Sign in with your Geopacific email</Text>

          {step === 'email' ? (
            <>
              <Text style={s.label}>Work Email</Text>
              <TextInput
                style={s.input}
                placeholder="you@geopacific.ca"
                placeholderTextColor={C.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                editable={!sending}
                onSubmitEditing={sendCode}
              />
              <TouchableOpacity
                style={[s.btn, sending && s.btnDisabled]}
                onPress={sendCode}
                disabled={sending}>
                {sending
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.btnTxt}>Send Code</Text>}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={s.label}>Verification Code</Text>
              <Text style={s.hint}>We sent a code to {email}</Text>
              <TextInput
                style={s.input}
                placeholder="123456"
                placeholderTextColor={C.muted}
                keyboardType="number-pad"
                value={code}
                onChangeText={setCode}
                editable={!verifying}
                onSubmitEditing={verifyCode}
              />
              <TouchableOpacity
                style={[s.btn, verifying && s.btnDisabled]}
                onPress={verifyCode}
                disabled={verifying}>
                {verifying
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.btnTxt}>Verify & Sign In</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={s.linkBtn} onPress={() => { setStep('email'); setCode(''); }}>
                <Text style={s.linkTxt}>Use a different email</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity style={s.offlineBtn} onPress={onOfflinePress}>
            <Text style={s.offlineTxt}>No signal? Continue offline</Text>
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
  subtitle: { color:'rgba(255,255,255,0.7)', fontSize:14, textAlign:'center', marginBottom:32 },
  label:    { color:'#fff', fontSize:13, fontWeight:'600', marginBottom:6 },
  hint:     { color:'rgba(255,255,255,0.6)', fontSize:12, marginBottom:10 },
  input:    { backgroundColor:'#fff', borderRadius:10, paddingHorizontal:14, paddingVertical:12,
              fontSize:15, color:C.text, marginBottom:16 },
  btn:      { backgroundColor:C.blue, borderRadius:10, paddingVertical:14, alignItems:'center' },
  btnDisabled: { opacity:0.6 },
  btnTxt:   { color:'#fff', fontWeight:'bold', fontSize:15 },
  linkBtn:  { marginTop:16, alignItems:'center' },
  linkTxt:  { color:'rgba(255,255,255,0.7)', fontSize:13, textDecorationLine:'underline' },
  offlineBtn: { marginTop:36, alignItems:'center' },
  offlineTxt: { color:'rgba(255,255,255,0.45)', fontSize:12 },
});
