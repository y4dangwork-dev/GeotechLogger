import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, Alert, Modal, ScrollView, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { DB } from '../storage/db';
import { MapPickerView } from '../components/MapPickerModal';
import { generateAGS4 } from '../utils/agsExport';
import GenerateLogsModal from '../components/GenerateLogsModal';

const C = { navy:'#1F3A5F', blue:'#2E75B6', bg:'#F8FAFC', white:'#fff',
            border:'#CBD5E1', muted:'#64748B', text:'#1E293B', red:'#DC2626' };

const BH_FIELDS = [
  ['Borehole Number*',      'boreholeNumber',   'e.g. BH-01'],
  ['Date',                  'date',             'e.g. 2024-04-22'],
  ['Datum',                 'datum',            'e.g. AHD'],
  ['Figure Number',         'figureNumber',     'e.g. A.01'],
  ['Ground Elevation (m AHD)', 'groundElevation', 'e.g. 52.30'],
  ['Groundwater Depth (m)', 'groundwaterDepth', 'e.g. 5.2'],
  ['Logged By',             'loggedBy',         'Override job default'],
  ['Method',                'method',           'Override job default'],
];

const BLANK_BH = { boreholeNumber:'', date:'', datum:'AHD', figureNumber:'', groundElevation:'', groundwaterDepth:'', loggedBy:'', method:'', latitude:null, longitude:null };

export default function JobScreen({ route, navigation }) {
  const { jobId, readOnly = false, communityJob } = route.params;
  const [job,          setJob]        = useState(communityJob || null);
  const [bhs,          setBhs]        = useState(communityJob?.boreholes || []);
  const [modal,        setModal]      = useState(false);
  const [editModal,    setEditModal]  = useState(false);
  const [editBhId,     setEditBhId]   = useState(null);
  const [form,         setForm]       = useState(BLANK_BH);
  const [generateOpen,  setGenerateOpen]  = useState(false);

  useFocusEffect(useCallback(() => {
    if (communityJob) return; // community jobs come from Supabase, not local DB
    DB.getJob(jobId).then(j => { setJob(j); setBhs(j?.boreholes || []); });
  }, [jobId, communityJob]));

  async function createBorehole() {
    if (!form.boreholeNumber.trim()) { Alert.alert('Required','Enter borehole number'); return; }
    await DB.createBorehole(jobId, form);
    setModal(false);
    setForm(BLANK_BH);
    DB.getJob(jobId).then(j => { setJob(j); setBhs(j?.boreholes||[]); });
  }

  function openEdit(bh) {
    setEditBhId(bh.id);
    setForm({
      boreholeNumber:   bh.boreholeNumber   || '',
      date:             bh.date             || '',
      datum:            bh.datum            || 'AHD',
      figureNumber:     bh.figureNumber     || '',
      groundElevation:  bh.groundElevation  || '',
      groundwaterDepth: bh.groundwaterDepth || '',
      loggedBy:         bh.loggedBy         || '',
      method:           bh.method           || '',
      latitude:         bh.latitude         || null,
      longitude:        bh.longitude        || null,
    });
    setEditModal(true);
  }

  async function saveEdit() {
    if (!form.boreholeNumber.trim()) { Alert.alert('Required','Enter borehole number'); return; }
    await DB.updateBorehole(jobId, editBhId, form);
    setEditModal(false);
    setEditBhId(null);
    setForm(BLANK_BH);
    DB.getJob(jobId).then(j => { setJob(j); setBhs(j?.boreholes||[]); });
  }

  function deleteBh(id) {
    Alert.alert('Delete Borehole','Delete this borehole and all its entries?',
      [{ text:'Cancel', style:'cancel' }, { text:'Delete', style:'destructive',
        onPress: async () => {
          await DB.deleteBorehole(jobId, id);
          DB.getJob(jobId).then(j => { setJob(j); setBhs(j?.boreholes||[]); });
        }
      }]);
  }

  async function exportAGS() {
    if (!job) return;
    try {
      const agsText = generateAGS4(job, bhs);
      const filename = `${job.jobNumber || 'export'}.ags`;

      if (Platform.OS === 'web') {
        const blob = new Blob([agsText], { type: 'text/plain' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const FileSystem = require('expo-file-system/legacy');
        const Sharing    = require('expo-sharing');
        const path = FileSystem.cacheDirectory + filename;
        await FileSystem.writeAsStringAsync(path, agsText, { encoding: 'utf8' });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(path, { mimeType: 'text/plain', dialogTitle: `Export ${filename}` });
        } else {
          Alert.alert('Exported', `Saved to: ${path}`);
        }
      }
    } catch (err) {
      Alert.alert('Export Failed', String(err));
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
          <Text style={s.backTxt}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{job?.projectName || 'Job'}</Text>
        {!readOnly && (
          <TouchableOpacity style={s.agsBtn} onPress={exportAGS}>
            <Text style={s.agsBtnTxt}>AGS ↓</Text>
          </TouchableOpacity>
        )}
        {readOnly
          ? <View style={s.readOnlyBadge}><Text style={s.readOnlyTxt}>👁 View Only</Text></View>
          : <TouchableOpacity style={s.addBtn} onPress={() => { setForm(BLANK_BH); setModal(true); }}>
              <Text style={s.addBtnTxt}>+ Borehole</Text>
            </TouchableOpacity>
        }
      </View>

      {/* Job info sub-header */}
      {job && (
        <View style={s.infoStrip}>
          <Text style={s.infoTxt} numberOfLines={1}>
            {[job.jobNumber, job.clientName].filter(Boolean).join(' · ')}
          </Text>
          <Text style={s.infoTxt} numberOfLines={1}>{job.locationName}</Text>
        </View>
      )}

      <FlatList
        data={bhs}
        keyExtractor={b => b.id}
        contentContainerStyle={s.list}
        ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTxt}>No boreholes yet</Text></View>}
        ListFooterComponent={bhs.length > 0 ? (
          <TouchableOpacity style={s.generateBlock} onPress={() => setGenerateOpen(true)}>
            <Text style={s.generateBlockTxt}>Generate Borehole Logging</Text>
          </TouchableOpacity>
        ) : null}
        renderItem={({ item:b }) => (
          <TouchableOpacity style={s.card}
            onPress={() => communityJob
              ? navigation.navigate('Borehole', { communityBh: b, readOnly: true })
              : navigation.navigate('Borehole', { jobId, bhId: b.id, readOnly })}>
            <View style={{flex:1}}>
              <Text style={s.cardTitle}>{b.boreholeNumber}</Text>
              <Text style={s.cardSub}>{[b.date, b.datum].filter(Boolean).join(' · ')}</Text>
              {b.groundwaterDepth ? <Text style={s.cardSub}>GW: {b.groundwaterDepth}m</Text> : null}
              <Text style={s.cardBadge}>{(b.entries||[]).length} entries</Text>
            </View>
            {!readOnly && (
              <View style={s.actions}>
                <TouchableOpacity onPress={() => openEdit(b)} style={s.iconBtn}>
                  <Text style={s.editTxt}>✎</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteBh(b.id)} style={s.iconBtn}>
                  <Text style={s.delTxt}>✕</Text>
                </TouchableOpacity>
              </View>
            )}
          </TouchableOpacity>
        )}
      />

      {/* ── Create Modal ── */}
      <BhFormModal
        visible={!readOnly && modal}
        title="New Borehole"
        form={form}
        setForm={setForm}
        onCancel={() => setModal(false)}
        onSubmit={createBorehole}
        submitLabel="Create"
      />

      {/* ── Edit Modal ── */}
      <BhFormModal
        visible={!readOnly && editModal}
        title="Edit Borehole Info"
        form={form}
        setForm={setForm}
        onCancel={() => setEditModal(false)}
        onSubmit={saveEdit}
        submitLabel="Save Changes"
      />

      {/* ── Generate Borehole Logging Modal ── */}
      <GenerateLogsModal
        visible={generateOpen}
        job={job}
        boreholes={bhs}
        onClose={() => setGenerateOpen(false)}
      />
    </SafeAreaView>
  );
}

function BhFormModal({ visible, title, form, setForm, onCancel, onSubmit, submitLabel }) {
  const [showMap, setShowMap] = React.useState(false);
  const hasLocation = form.latitude != null && form.longitude != null;

  React.useEffect(() => { if (!visible) setShowMap(false); }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent={!showMap}
      onRequestClose={showMap ? () => setShowMap(false) : onCancel}>

      {showMap ? (
        <MapPickerView
          initialLat={form.latitude}
          initialLng={form.longitude}
          onConfirm={coords => {
            setForm(f => ({ ...f, latitude: coords.lat, longitude: coords.lng }));
            setShowMap(false);
          }}
          onCancel={() => setShowMap(false)}
        />
      ) : (
      <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>{title}</Text>
          <ScrollView keyboardShouldPersistTaps="handled">
            {BH_FIELDS.map(([lbl, key, ph]) => (
              <View key={key} style={s.field}>
                <Text style={s.label}>{lbl}</Text>
                <TextInput style={s.input} placeholder={ph} value={form[key]}
                  keyboardType={key==='groundwaterDepth'||key==='groundElevation'?'decimal-pad':'default'}
                  onChangeText={v => setForm(f=>({...f,[key]:v}))} />
              </View>
            ))}
            <View style={s.field}>
              <Text style={s.label}>Borehole Location (GIS)</Text>
              <TouchableOpacity style={[s.mapBtn, hasLocation && s.mapBtnSet]}
                onPress={() => setShowMap(true)}>
                <Text style={s.mapBtnTxt}>
                  {hasLocation
                    ? `📍 ${form.latitude.toFixed(5)},  ${form.longitude.toFixed(5)}`
                    : '🗺  Tap to pin borehole on map'}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
          <View style={s.row}>
            <TouchableOpacity style={s.btnOutline} onPress={onCancel}>
              <Text style={s.btnOutlineTxt}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.btnPrimary} onPress={onSubmit}>
              <Text style={s.btnPrimaryTxt}>{submitLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
      )}
    </Modal>
  );
}

const s = StyleSheet.create({
  safe:         { flex:1, backgroundColor:C.navy },
  header:       { flexDirection:'row', alignItems:'center', padding:12, backgroundColor:C.navy, gap:8 },
  back:         { paddingHorizontal:4 },
  backTxt:      { color:'#fff', fontSize:14 },
  headerTitle:  { flex:1, color:'#fff', fontSize:16, fontWeight:'bold' },
  agsBtn:       { backgroundColor:'rgba(255,255,255,0.18)', borderWidth:1, borderColor:'rgba(255,255,255,0.5)', paddingHorizontal:10, paddingVertical:6, borderRadius:8 },
  agsBtnTxt:    { color:'#fff', fontWeight:'600', fontSize:12 },
  readOnlyBadge:{ backgroundColor:'rgba(255,255,255,0.15)', paddingHorizontal:10, paddingVertical:6, borderRadius:8 },
  readOnlyTxt:  { color:'rgba(255,255,255,0.8)', fontSize:12 },
  addBtn:       { backgroundColor:'#fff', paddingHorizontal:12, paddingVertical:6, borderRadius:8 },
  addBtnTxt:    { color:C.navy, fontWeight:'bold', fontSize:12 },
  infoStrip:    { backgroundColor:'rgba(46,117,182,0.85)', paddingHorizontal:16, paddingVertical:5 },
  infoTxt:      { color:'#fff', fontSize:12 },
  list:         { padding:12, backgroundColor:C.bg, flexGrow:1 },
  card:         { backgroundColor:C.white, borderRadius:10, padding:14, marginBottom:10,
                  borderWidth:1, borderColor:C.border, flexDirection:'row', alignItems:'flex-start' },
  cardTitle:    { fontSize:15, fontWeight:'bold', color:C.navy },
  cardSub:      { fontSize:12, color:C.muted, marginTop:2 },
  cardBadge:    { marginTop:4, fontSize:11, color:C.blue, fontWeight:'600' },
  actions:      { flexDirection:'row', gap:4, alignItems:'center' },
  iconBtn:      { padding:6 },
  editTxt:      { color:C.blue, fontSize:17 },
  delTxt:       { color:C.red, fontSize:16 },
  empty:        { alignItems:'center', paddingVertical:60 },
  emptyTxt:     { fontSize:16, color:C.muted },
  generateBlock:{ backgroundColor:C.blue, borderRadius:12, padding:18,
                  alignItems:'center', marginTop:8, marginBottom:16 },
  generateBlockTxt:{ color:'#fff', fontSize:15, fontWeight:'bold' },
  overlay:      { flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'flex-end' },
  sheet:        { backgroundColor:C.white, borderTopLeftRadius:16, borderTopRightRadius:16,
                  padding:20, paddingBottom:40, maxHeight:'90%' },
  sheetTitle:   { fontSize:18, fontWeight:'bold', color:C.navy, marginBottom:16 },
  field:        { marginBottom:10 },
  label:        { fontSize:12, fontWeight:'600', color:C.muted, marginBottom:4 },
  input:        { borderWidth:1.5, borderColor:C.border, borderRadius:8, padding:10, fontSize:13 },
  row:          { flexDirection:'row', gap:10, marginTop:12 },
  btnOutline:   { flex:1, borderWidth:1.5, borderColor:C.blue, borderRadius:8, padding:12, alignItems:'center' },
  btnOutlineTxt:{ color:C.blue, fontWeight:'600' },
  btnPrimary:   { flex:1, backgroundColor:C.blue, borderRadius:8, padding:12, alignItems:'center' },
  btnPrimaryTxt:{ color:'#fff', fontWeight:'600' },
  mapBtn:       { borderWidth:1.5, borderColor:'#CBD5E1', borderRadius:8, padding:12,
                  backgroundColor:'#fff', alignItems:'center' },
  mapBtnSet:    { borderColor:'#2E75B6', backgroundColor:'#EFF6FF' },
  mapBtnTxt:    { fontSize:13, color:'#64748B' },
});
