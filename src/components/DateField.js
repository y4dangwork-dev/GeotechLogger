import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Platform, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

const C = { blue:'#2E75B6', border:'#CBD5E1', muted:'#64748B', text:'#1E293B' };

// 'YYYY-MM-DD' <-> Date, kept local (not UTC) so the picker shows the date
// the person actually tapped, not one shifted by timezone.
function toISODate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseISODate(s) {
  if (!s) return new Date();
  const d = new Date(`${s}T00:00:00`);
  return isNaN(d.getTime()) ? new Date() : d;
}

// A tap-to-open date field backed by the native date picker (a scrollable
// "wheel" on iOS via display="spinner", the native calendar dialog on
// Android). Replaces free-text date entry so the value is always a valid,
// consistently-formatted date.
export default function DateField({ value, onChange, placeholder = 'Tap to set date' }) {
  const [show, setShow] = useState(false);

  function handleChange(event, selected) {
    if (Platform.OS === 'android') setShow(false);
    if (event.type === 'dismissed') return;
    if (selected) onChange(toISODate(selected));
  }

  return (
    <>
      <TouchableOpacity style={s.input} onPress={() => setShow(true)} activeOpacity={0.7}>
        <Text style={{ color: value ? C.text : C.muted, fontSize: 15 }}>{value || placeholder}</Text>
      </TouchableOpacity>

      {show && Platform.OS === 'android' && (
        <DateTimePicker value={parseISODate(value)} mode="date" display="default" onChange={handleChange} />
      )}

      {show && Platform.OS === 'ios' && (
        <Modal transparent animationType="slide" visible={show} onRequestClose={() => setShow(false)}>
          <View style={s.overlay}>
            <View style={s.sheet}>
              <View style={s.sheetHeader}>
                <TouchableOpacity onPress={() => setShow(false)}>
                  <Text style={s.doneTxt}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={parseISODate(value)}
                mode="date"
                display="spinner"
                onChange={handleChange}
                style={{ backgroundColor: '#fff' }}
              />
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}

const s = StyleSheet.create({
  input: { backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: C.border,
           paddingHorizontal: 12, paddingVertical: 12, justifyContent: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'flex-end', padding: 10,
                 borderBottomWidth: 1, borderBottomColor: C.border },
  doneTxt: { color: C.blue, fontWeight: '600', fontSize: 15 },
});
