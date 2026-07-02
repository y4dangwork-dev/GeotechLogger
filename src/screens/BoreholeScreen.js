import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, Alert, Modal, ActivityIndicator,
  ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { DB } from '../storage/db';
import { renderBorehole } from '../renderer/pdfRenderer';
import DateField from '../components/DateField';

// Convert Uint8Array → base64 string (replacement for pdf-lib's non-public encodeToBase64)
function uint8ToBase64(bytes) {
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const C = { navy:'#1F3A5F', blue:'#2E75B6', bg:'#F8FAFC', white:'#fff',
            border:'#CBD5E1', muted:'#64748B', text:'#1E293B', red:'#DC2626', green:'#16A34A' };

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

const BH_FIELDS = [
  ['Borehole Number*',         'boreholeNumber',   'e.g. BH-01'],
  ['Date',                     'date',             'Tap to set date'],
  ['Datum',                    'datum',            'e.g. Ground Elevation'],
  ['Figure Number',            'figureNumber',     'e.g. A.01'],
  ['Ground Elevation (m AHD)', 'groundElevation',  'e.g. 52.30'],
  ['Groundwater Depth (m)',    'groundwaterDepth', 'e.g. 5.2'],
  ['Logged By',                'loggedBy',         'e.g. U. Ahmad'],
  ['Method',                   'method',           'e.g. Hollow Stem Auger'],
];

export default function BoreholeScreen({ route, navigation }) {
  const { jobId, bhId, readOnly: readOnlyParam = false, communityBh } = route.params;
  // Community boreholes are read-only here too — edit locally, then re-publish.
  const readOnly = readOnlyParam || !!communityBh;
  const [job,       setJob]       = useState(null);
  const [borehole,  setBorehole]  = useState(communityBh || null);
  const [entries,   setEntries]   = useState(communityBh?.entries || []);
  const [dcpt,      setDcpt]      = useState(communityBh?.dcpt    || []);
  const [fc,        setFc]        = useState(communityBh?.fc      || []);
  const [tab,       setTab]       = useState('entries'); // 'entries' | 'fc' | 'dcpt'
  const [loading,       setLoading]       = useState(false);
  const [editModal,     setEditModal]     = useState(false);
  const [previewModal,  setPreviewModal]  = useState(false);
  const [form,      setForm]      = useState({});
  // DCPT add form
  const [dcptDepth, setDcptDepth] = useState('');
  const [dcptBlows, setDcptBlows] = useState('');
  // Fine Content add form
  const [fcDepth,   setFcDepth]   = useState('');
  const [fcValue,   setFcValue]   = useState('');

  const reload = useCallback(() => {
    if (communityBh) return; // community data comes from params, not local DB
    DB.getJob(jobId).then(j => {
      setJob(j);
      const bh = (j?.boreholes||[]).find(b=>b.id===bhId);
      setBorehole(bh||null);
      setEntries(bh?.entries||[]);
      setDcpt(bh?.dcpt||[]);
      setFc(bh?.fc||[]);
    });
  }, [jobId, bhId, communityBh]);

  useFocusEffect(reload);

  function openEdit() {
    if (!borehole) return;
    setForm({
      boreholeNumber:   borehole.boreholeNumber   || '',
      date:             borehole.date             || todayISO(),
      datum:            borehole.datum            || 'Ground Elevation',
      figureNumber:     borehole.figureNumber     || '',
      groundElevation:  borehole.groundElevation  || '',
      groundwaterDepth: borehole.groundwaterDepth || '',
      loggedBy:         borehole.loggedBy         || '',
      method:           borehole.method           || '',
    });
    setEditModal(true);
  }

  async function saveEdit() {
    if (!form.boreholeNumber.trim()) { Alert.alert('Required','Enter borehole number'); return; }
    await DB.updateBorehole(jobId, bhId, form);
    setEditModal(false);
    reload();
  }

  async function addDcpt() {
    const d = parseFloat(dcptDepth), b = parseInt(dcptBlows, 10);
    if (isNaN(d) || isNaN(b) || b < 0) {
      Alert.alert('Error','Enter valid depth and blows'); return;
    }
    await DB.addDcptReading(jobId, bhId, d, b);
    setDcptDepth(''); setDcptBlows('');
    reload();
  }

  function deleteDcpt(idx) {
    Alert.alert('Delete', 'Remove this DCPT reading?',
      [{ text:'Cancel', style:'cancel' },
       { text:'Delete', style:'destructive', onPress: async () => {
           await DB.deleteDcptReading(jobId, bhId, idx); reload();
         }}]);
  }

  async function addFc() {
    const d = parseFloat(fcDepth), v = parseFloat(fcValue);
    if (isNaN(d) || isNaN(v) || v < 0 || v > 100) {
      Alert.alert('Error','Enter valid depth and FC% (0–100)'); return;
    }
    await DB.addFcReading(jobId, bhId, d, v);
    setFcDepth(''); setFcValue('');
    reload();
  }

  function deleteFc(idx) {
    Alert.alert('Delete', 'Remove this Fine Content reading?',
      [{ text:'Cancel', style:'cancel' },
       { text:'Delete', style:'destructive', onPress: async () => {
           await DB.deleteFcReading(jobId, bhId, idx); reload();
         }}]);
  }

  async function doGeneratePDF() {
    if (!borehole) return;
    setPreviewModal(false);
    // For community boreholes, construct a minimal job object from borehole metadata
    const effectiveJob = job || {
      jobNumber:    '',
      projectName:  borehole.boreholeNumber || 'Community Log',
      clientName:   '',
      locationName: '',
    };
    setLoading(true);
    try {
      const bhWithDcpt = { ...borehole, dcpt: dcpt.map(r => [r.depth, r.blows]), fc };
      const pdfBytes   = await renderBorehole(effectiveJob, bhWithDcpt);
      const filename   = `borehole_${borehole.boreholeNumber || 'log'}.pdf`;

      if (Platform.OS === 'web') {
        // Web: trigger browser download
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } else {
        // Native: write to file then share
        const fileUri = FileSystem.documentDirectory + filename;
        await FileSystem.writeAsStringAsync(fileUri, uint8ToBase64(pdfBytes),
          { encoding: FileSystem.EncodingType.Base64 });
        await Sharing.shareAsync(fileUri, { mimeType:'application/pdf', dialogTitle:`Share ${filename}` });
      }
    } catch (err) {
      Alert.alert('PDF Error', err.message || String(err));
      console.error(err);
    } finally { setLoading(false); }
  }

  function deleteEntry(id) {
    Alert.alert('Delete Entry','Delete this soil layer entry?',
      [{ text:'Cancel', style:'cancel' }, { text:'Delete', style:'destructive',
        onPress: async () => { await DB.deleteEntry(jobId, bhId, id); reload(); }
      }]);
  }

  const sorted = [...entries].sort((a,b) => parseFloat(a.depthFrom)-parseFloat(b.depthFrom));

  return (
    <SafeAreaView style={s.safe}>
      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
          <Text style={s.backTxt}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{borehole?.boreholeNumber || 'Borehole'}</Text>
        {!readOnly && (
          <TouchableOpacity onPress={openEdit} style={s.editBtn}>
            <Text style={s.editBtnTxt}>✎ Edit</Text>
          </TouchableOpacity>
        )}
        {!readOnly && (
          <TouchableOpacity style={s.addBtn}
            onPress={() => navigation.navigate('Entry', { jobId, bhId, entryId: null })}>
            <Text style={s.addBtnTxt}>+ Entry</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Info strip ── */}
      {borehole && (
        <View style={s.infoStrip}>
          <Text style={s.infoTxt}>{[borehole.date, borehole.datum].filter(Boolean).join(' · ')}</Text>
          {borehole.groundElevation  ? <Text style={s.infoTxt}>RL: {borehole.groundElevation}m AHD</Text> : null}
          {borehole.groundwaterDepth ? <Text style={s.infoTxt}>GW: {borehole.groundwaterDepth}m</Text>     : null}
        </View>
      )}

      {/* ── Tabs ── */}
      <View style={s.tabs}>
        {[
          { key:'entries', label:`Soil Layers (${entries.length})` },
          { key:'fc',      label:`Fine Content (${fc.length})` },
          { key:'dcpt',    label:`DCPT (${dcpt.length})` },
        ].map(({ key, label }) => (
          <TouchableOpacity key={key} style={[s.tab, tab===key && s.tabActive]} onPress={() => setTab(key)}>
            <Text style={[s.tabTxt, tab===key && s.tabActiveTxt]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Entries tab ── */}
      {tab === 'entries' && (
        <FlatList
          data={sorted}
          keyExtractor={(e, i) => e.id || `${e.depthFrom ?? ''}-${e.depthTo ?? ''}-${i}`}
          contentContainerStyle={s.list}
          ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTxt}>No entries yet</Text></View>}
          renderItem={({ item:e }) => (
            <TouchableOpacity style={s.card}
              onPress={() => communityBh
                ? navigation.navigate('Entry', { communityEntry: e, readOnly: true })
                : navigation.navigate('Entry', { jobId, bhId, entryId: e.id, readOnly })}>
              <View style={s.depthCol}>
                <Text style={s.depth}>{e.depthFrom}m</Text>
                <View style={s.depthLine} />
                <Text style={s.depth}>{e.depthTo}m</Text>
              </View>
              <View style={{flex:1}}>
                <Text style={s.soilType}>{e.soilType}</Text>
                <Text style={s.desc} numberOfLines={2}>{e.description}</Text>
                <Text style={s.cond}>{[e.condition,e.moisture].filter(Boolean).join(', ')}</Text>
              </View>
              {!readOnly && (
                <TouchableOpacity onPress={() => deleteEntry(e.id)} style={s.delBtn}>
                  <Text style={s.delTxt}>✕</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          )}
          ListFooterComponent={
            <TouchableOpacity style={[s.pdfBtn, loading && s.pdfBtnLoading]}
              onPress={() => setPreviewModal(true)} disabled={loading}>
              {loading ? <ActivityIndicator color="#fff" />
                       : <Text style={s.pdfBtnTxt}>⬇ Generate PDF</Text>}
            </TouchableOpacity>
          }
        />
      )}

      {/* ── Fine Content tab ── */}
      {tab === 'fc' && (
        <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':'height'}>
          {!readOnly && (
            <View style={s.dcptAdd}>
              <Text style={s.dcptAddTitle}>Add Fine Content Reading</Text>
              <View style={s.dcptRow}>
                <View style={s.dcptField}>
                  <Text style={s.dcptLabel}>Depth (m)</Text>
                  <TextInput style={s.dcptInput} keyboardType="decimal-pad"
                    placeholder="e.g. 1.5" value={fcDepth} onChangeText={setFcDepth} />
                </View>
                <View style={s.dcptField}>
                  <Text style={s.dcptLabel}>FC (%)</Text>
                  <TextInput style={s.dcptInput} keyboardType="decimal-pad"
                    placeholder="e.g. 35" value={fcValue} onChangeText={setFcValue} />
                </View>
                <TouchableOpacity style={s.dcptAddBtn} onPress={addFc}>
                  <Text style={s.dcptAddBtnTxt}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <FlatList
            data={fc}
            keyExtractor={(_,i) => String(i)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.list}
            ListEmptyComponent={
              <View style={s.empty}>
                <Text style={s.emptyTxt}>No Fine Content readings yet</Text>
                <Text style={s.emptyHint}>Add depth + FC% above</Text>
              </View>
            }
            renderItem={({ item:r, index:i }) => (
              <View style={[s.card, s.dcptCard]}>
                <View style={s.dcptBar}>
                  <View style={[s.dcptFill, { width: `${Math.min(r.fc, 100)}%` }]} />
                </View>
                <Text style={s.dcptDepthTxt}>{r.depth.toFixed(1)}m</Text>
                <Text style={s.dcptBlowsTxt}>{r.fc.toFixed(1)}%</Text>
                {r.fc > 50 && <Text style={[s.refusalTxt, { color:'#7C3AED' }]}>FINE</Text>}
                {!readOnly && (
                  <TouchableOpacity onPress={() => deleteFc(i)} style={s.delBtn}>
                    <Text style={s.delTxt}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          />
        </KeyboardAvoidingView>
      )}

      {/* ── DCPT tab ── */}
      {tab === 'dcpt' && (
        <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':'height'}>
          {!readOnly && (
            <View style={s.dcptAdd}>
              <Text style={s.dcptAddTitle}>Add DCPT Reading</Text>
              <View style={s.dcptRow}>
                <View style={s.dcptField}>
                  <Text style={s.dcptLabel}>Depth (m)</Text>
                  <TextInput style={s.dcptInput} keyboardType="decimal-pad"
                    placeholder="e.g. 1.5" value={dcptDepth} onChangeText={setDcptDepth} />
                </View>
                <View style={s.dcptField}>
                  <Text style={s.dcptLabel}>Blows</Text>
                  <TextInput style={s.dcptInput} keyboardType="number-pad"
                    placeholder="e.g. 12" value={dcptBlows} onChangeText={setDcptBlows} />
                </View>
                <TouchableOpacity style={s.dcptAddBtn} onPress={addDcpt}>
                  <Text style={s.dcptAddBtnTxt}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <FlatList
            data={dcpt}
            keyExtractor={(_,i) => String(i)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.list}
            ListEmptyComponent={
              <View style={s.empty}>
                <Text style={s.emptyTxt}>No DCPT readings yet</Text>
                <Text style={s.emptyHint}>Add depth + blows above</Text>
              </View>
            }
            renderItem={({ item:r, index:i }) => (
              <View style={[s.card, s.dcptCard]}>
                <View style={s.dcptBar}>
                  <View style={[s.dcptFill, { width: `${Math.min(r.blows, 50) * 2}%` }]} />
                </View>
                <Text style={s.dcptDepthTxt}>{r.depth.toFixed(1)}m</Text>
                <Text style={s.dcptBlowsTxt}>{r.blows} blows</Text>
                {r.blows >= 50 && <Text style={s.refusalTxt}>REFUSAL</Text>}
                {!readOnly && (
                  <TouchableOpacity onPress={() => deleteDcpt(i)} style={s.delBtn}>
                    <Text style={s.delTxt}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            ListFooterComponent={
              dcpt.length > 0 ? (
                <TouchableOpacity style={[s.pdfBtn, loading && s.pdfBtnLoading]}
                  onPress={() => setPreviewModal(true)} disabled={loading}>
                  {loading ? <ActivityIndicator color="#fff" />
                           : <Text style={s.pdfBtnTxt}>⬇ Generate PDF</Text>}
                </TouchableOpacity>
              ) : null
            }
          />
        </KeyboardAvoidingView>
      )}

      {/* ── PDF Preview Modal ── */}
      <Modal
        visible={previewModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPreviewModal(false)}
      >
        <View style={s.previewContainer}>
          {/* Header */}
          <View style={s.previewHeader}>
            <Text style={s.previewTitle}>PDF Preview</Text>
            <TouchableOpacity onPress={() => setPreviewModal(false)} hitSlop={{top:10,bottom:10,left:10,right:10}}>
              <Text style={s.previewClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{flex:1}} contentContainerStyle={s.previewBody}>

            {/* Project section */}
            <View style={s.previewSection}>
              <Text style={s.previewSectionTitle}>PROJECT</Text>
              {job?.jobNumber    ? <View style={s.previewRow}><Text style={s.previewKey}>Job No.</Text><Text style={s.previewVal}>{job.jobNumber}</Text></View> : null}
              {job?.projectName  ? <View style={s.previewRow}><Text style={s.previewKey}>Project</Text><Text style={s.previewVal}>{job.projectName}</Text></View> : null}
              {job?.clientName   ? <View style={s.previewRow}><Text style={s.previewKey}>Client</Text><Text style={s.previewVal}>{job.clientName}</Text></View> : null}
              {job?.locationName ? <View style={s.previewRow}><Text style={s.previewKey}>Address</Text><Text style={s.previewVal}>{job.locationName}</Text></View> : null}
            </View>

            {/* Borehole section */}
            <View style={s.previewSection}>
              <Text style={s.previewSectionTitle}>BOREHOLE</Text>
              {borehole?.boreholeNumber  ? <View style={s.previewRow}><Text style={s.previewKey}>BH No.</Text><Text style={s.previewVal}>{borehole.boreholeNumber}</Text></View> : null}
              {borehole?.date            ? <View style={s.previewRow}><Text style={s.previewKey}>Date</Text><Text style={s.previewVal}>{borehole.date}</Text></View> : null}
              {borehole?.loggedBy        ? <View style={s.previewRow}><Text style={s.previewKey}>Logged By</Text><Text style={s.previewVal}>{borehole.loggedBy}</Text></View> : null}
              {borehole?.method          ? <View style={s.previewRow}><Text style={s.previewKey}>Method</Text><Text style={s.previewVal}>{borehole.method}</Text></View> : null}
              {borehole?.groundElevation ? <View style={s.previewRow}><Text style={s.previewKey}>Ground RL</Text><Text style={s.previewVal}>{borehole.groundElevation} m AHD</Text></View> : null}
              {borehole?.groundwaterDepth? <View style={s.previewRow}><Text style={s.previewKey}>GW Depth</Text><Text style={s.previewVal}>{borehole.groundwaterDepth} m</Text></View> : null}
              {borehole?.datum           ? <View style={s.previewRow}><Text style={s.previewKey}>Datum</Text><Text style={s.previewVal}>{borehole.datum}</Text></View> : null}
              {borehole?.figureNumber    ? <View style={s.previewRow}><Text style={s.previewKey}>Fig. No.</Text><Text style={s.previewVal}>{borehole.figureNumber}</Text></View> : null}
            </View>

            {/* Soil log summary */}
            <View style={s.previewSection}>
              <Text style={s.previewSectionTitle}>SOIL LOG  ({entries.length} {entries.length === 1 ? 'layer' : 'layers'})</Text>
              {entries.length === 0 ? (
                <Text style={s.previewEmpty}>No soil entries recorded</Text>
              ) : (
                [...entries]
                  .sort((a,b) => parseFloat(a.depthFrom) - parseFloat(b.depthFrom))
                  .slice(0, 6)
                  .map((e, i) => (
                    <View key={e.id || i} style={s.previewRow}>
                      <Text style={s.previewKey}>{e.depthFrom}–{e.depthTo}m</Text>
                      <Text style={s.previewVal} numberOfLines={1}>{e.soilType}{e.condition ? ` · ${e.condition}` : ''}</Text>
                    </View>
                  ))
              )}
              {entries.length > 6 && (
                <Text style={s.previewMore}>+{entries.length - 6} more layers…</Text>
              )}
              {fc.length > 0 && (
                <Text style={s.previewDcpt}>Fine Content: {fc.length} readings</Text>
              )}
              {dcpt.length > 0 && (
                <Text style={s.previewDcpt}>DCPT: {dcpt.length} readings</Text>
              )}
            </View>

          </ScrollView>

          {/* Action buttons */}
          <View style={s.previewFooter}>
            <TouchableOpacity style={s.previewCancelBtn} onPress={() => setPreviewModal(false)}>
              <Text style={s.previewCancelTxt}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.previewGenBtn, loading && s.previewGenBtnLoading]}
              onPress={doGeneratePDF} disabled={loading}>
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.previewGenTxt}>⬇ Generate PDF</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Edit Modal ── */}
      <Modal visible={editModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Edit Borehole Info</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {BH_FIELDS.map(([lbl,key,ph]) => (
                <View key={key} style={s.field}>
                  <Text style={s.label}>{lbl}</Text>
                  {key === 'date' ? (
                    <DateField value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} />
                  ) : (
                    <TextInput style={s.input} placeholder={ph} value={form[key]||''}
                      keyboardType={['groundwaterDepth','groundElevation'].includes(key)?'decimal-pad':'default'}
                      onChangeText={v => setForm(f=>({...f,[key]:v}))} />
                  )}
                </View>
              ))}
            </ScrollView>
            <View style={s.row}>
              <TouchableOpacity style={s.btnOutline} onPress={() => setEditModal(false)}>
                <Text style={s.btnOutlineTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnPrimary} onPress={saveEdit}>
                <Text style={s.btnPrimaryTxt}>Save Changes</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}


const s = StyleSheet.create({
  safe:          { flex:1, backgroundColor:C.navy },
  header:        { flexDirection:'row', alignItems:'center', padding:12, backgroundColor:C.navy, gap:6 },
  back:          { paddingHorizontal:4 },
  backTxt:       { color:'#fff', fontSize:14 },
  headerTitle:   { flex:1, color:'#fff', fontSize:16, fontWeight:'bold' },
  editBtn:       { paddingHorizontal:8, paddingVertical:5, borderRadius:6,
                   borderWidth:1, borderColor:'rgba(255,255,255,0.4)' },
  editBtnTxt:    { color:'#fff', fontSize:12 },
  addBtn:        { backgroundColor:'#fff', paddingHorizontal:10, paddingVertical:6, borderRadius:8 },
  addBtnTxt:     { color:C.navy, fontWeight:'bold', fontSize:12 },
  infoStrip:     { backgroundColor:C.blue, paddingHorizontal:16, paddingVertical:6,
                   flexDirection:'row', gap:14, flexWrap:'wrap' },
  infoTxt:       { color:'#fff', fontSize:12 },

  tabs:          { flexDirection:'row', backgroundColor:C.white, borderBottomWidth:1, borderColor:C.border },
  tab:           { flex:1, paddingVertical:10, alignItems:'center' },
  tabActive:     { borderBottomWidth:2, borderColor:C.navy },
  tabTxt:        { fontSize:12, color:C.muted, fontWeight:'600' },
  tabActiveTxt:  { color:C.navy },

  list:          { padding:12, backgroundColor:C.bg, flexGrow:1, paddingBottom:24 },
  card:          { backgroundColor:C.white, borderRadius:10, padding:12, marginBottom:8,
                   borderWidth:1, borderColor:C.border, flexDirection:'row', gap:10, alignItems:'center' },
  depthCol:      { alignItems:'center', width:44 },
  depth:         { fontSize:11, color:C.muted, fontWeight:'600' },
  depthLine:     { flex:1, width:1, backgroundColor:C.border, marginVertical:2, minHeight:12 },
  soilType:      { fontSize:14, fontWeight:'bold', color:C.navy },
  desc:          { fontSize:12, color:C.muted, marginTop:2 },
  cond:          { fontSize:11, color:C.blue, marginTop:2 },
  delBtn:        { padding:4 },
  delTxt:        { color:C.red, fontSize:16 },
  empty:         { alignItems:'center', paddingVertical:60 },
  emptyTxt:      { fontSize:16, color:C.muted },
  emptyHint:     { fontSize:12, color:C.muted, marginTop:4 },
  pdfBtn:        { backgroundColor:C.navy, borderRadius:10, padding:16, alignItems:'center', margin:12 },
  pdfBtnLoading: { backgroundColor:C.muted },
  pdfBtnTxt:     { color:'#fff', fontWeight:'bold', fontSize:15 },

  // DCPT
  dcptAdd:       { backgroundColor:C.white, padding:14, borderBottomWidth:1, borderColor:C.border },
  dcptAddTitle:  { fontSize:12, fontWeight:'700', color:C.navy, marginBottom:8,
                   textTransform:'uppercase', letterSpacing:0.5 },
  dcptRow:       { flexDirection:'row', alignItems:'flex-end', gap:8 },
  dcptField:     { flex:1 },
  dcptLabel:     { fontSize:11, color:C.muted, fontWeight:'600', marginBottom:3 },
  dcptInput:     { borderWidth:1.5, borderColor:C.border, borderRadius:8, padding:9, fontSize:14 },
  dcptAddBtn:    { backgroundColor:C.navy, paddingHorizontal:18, paddingVertical:10,
                   borderRadius:8, alignItems:'center' },
  dcptAddBtnTxt: { color:'#fff', fontWeight:'bold', fontSize:14 },
  dcptCard:      { gap:8, alignItems:'center' },
  dcptBar:       { height:8, flex:1, backgroundColor:'#E2E8F0', borderRadius:4, overflow:'hidden' },
  dcptFill:      { height:'100%', backgroundColor:C.blue, borderRadius:4 },
  dcptDepthTxt:  { fontSize:12, fontWeight:'700', color:C.navy, width:44, textAlign:'center' },
  dcptBlowsTxt:  { fontSize:12, color:C.muted, width:60 },
  refusalTxt:    { fontSize:9, fontWeight:'700', color:C.red },

  // PDF Preview Modal
  previewContainer:    { flex:1, backgroundColor:C.bg },
  previewHeader:       { flexDirection:'row', alignItems:'center', justifyContent:'space-between',
                         backgroundColor:C.navy, paddingHorizontal:20, paddingVertical:16,
                         paddingTop: Platform.OS === 'ios' ? 56 : 16 },
  previewTitle:        { color:'#fff', fontSize:17, fontWeight:'bold' },
  previewClose:        { color:'rgba(255,255,255,0.7)', fontSize:18, paddingHorizontal:4 },
  previewBody:         { padding:16, paddingBottom:24 },
  previewSection:      { backgroundColor:C.white, borderRadius:12, padding:16, marginBottom:12,
                         borderWidth:1, borderColor:C.border },
  previewSectionTitle: { fontSize:11, fontWeight:'700', color:C.blue, letterSpacing:1,
                         textTransform:'uppercase', marginBottom:10 },
  previewRow:          { flexDirection:'row', marginBottom:7 },
  previewKey:          { fontSize:13, color:C.muted, fontWeight:'600', width:90 },
  previewVal:          { fontSize:13, color:C.text, flex:1 },
  previewEmpty:        { fontSize:13, color:C.muted, fontStyle:'italic' },
  previewMore:         { fontSize:12, color:C.blue, marginTop:6, fontStyle:'italic' },
  previewDcpt:         { fontSize:12, color:C.navy, fontWeight:'600', marginTop:8,
                         paddingTop:8, borderTopWidth:1, borderColor:C.border },
  previewFooter:       { flexDirection:'row', gap:12, padding:16,
                         borderTopWidth:1, borderColor:C.border, backgroundColor:C.white,
                         paddingBottom: Platform.OS === 'ios' ? 32 : 16 },
  previewCancelBtn:    { flex:1, borderWidth:1.5, borderColor:C.blue, borderRadius:10,
                         padding:14, alignItems:'center' },
  previewCancelTxt:    { color:C.blue, fontWeight:'600', fontSize:15 },
  previewGenBtn:       { flex:2, backgroundColor:C.navy, borderRadius:10, padding:14, alignItems:'center' },
  previewGenBtnLoading:{ backgroundColor:C.muted },
  previewGenTxt:       { color:'#fff', fontWeight:'bold', fontSize:15 },

  overlay:       { flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'flex-end' },
  sheet:         { backgroundColor:C.white, borderTopLeftRadius:16, borderTopRightRadius:16,
                   padding:20, paddingBottom:40, maxHeight:'90%' },
  sheetTitle:    { fontSize:18, fontWeight:'bold', color:C.navy, marginBottom:16 },
  field:         { marginBottom:10 },
  label:         { fontSize:12, fontWeight:'600', color:C.muted, marginBottom:4 },
  input:         { borderWidth:1.5, borderColor:C.border, borderRadius:8, padding:10, fontSize:13 },
  row:           { flexDirection:'row', gap:10, marginTop:12 },
  btnOutline:    { flex:1, borderWidth:1.5, borderColor:C.blue, borderRadius:8, padding:12, alignItems:'center' },
  btnOutlineTxt: { color:C.blue, fontWeight:'600' },
  btnPrimary:    { flex:1, backgroundColor:C.blue, borderRadius:8, padding:12, alignItems:'center' },
  btnPrimaryTxt: { color:'#fff', fontWeight:'600' },
});
