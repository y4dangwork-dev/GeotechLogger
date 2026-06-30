import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, Alert, Modal, StatusBar,
  ScrollView, ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { DB } from '../storage/db';
import { MapPickerView } from '../components/MapPickerModal';
import { getCommunityJobs, getCommunityJobDetail, publishJob as supabasePublish, unpublishJob } from '../lib/supabase';

// Resolve the best coordinates for a community job:
// 1. Job-level GPS  2. First borehole with GPS  3. null
function resolveJobCoords(j) {
  if (j.latitude != null && j.longitude != null)
    return { lat: j.latitude, lng: j.longitude };
  const bhs = Array.isArray(j.boreholes_data) ? j.boreholes_data : [];
  for (const bh of bhs) {
    if (bh.latitude != null && bh.longitude != null)
      return { lat: bh.latitude, lng: bh.longitude };
  }
  return null;
}

// ── Leaflet community map ────────────────────────────────────────────────────

const COMMUNITY_MAP_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{margin:0;padding:0;width:100%;height:100%;}</style>
</head>
<body>
<div id="map"></div>
<script>
var map = L.map('map').setView([-25, 133], 4);
/* Google Earth satellite — pure imagery, no language labels */
L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
  {attribution:'&copy; Google',maxZoom:21}).addTo(map);

var markers = {};

function loadPins(pins) {
  Object.values(markers).forEach(function(m){map.removeLayer(m);});
  markers = {};
  if (!pins || pins.length === 0) return;
  var latlngs = [];
  pins.forEach(function(p) {
    var m = L.circleMarker([p.lat, p.lng], {
      radius:10, fillColor:'#1F3A5F',
      color:'#fff', weight:2, opacity:1, fillOpacity:0.9
    });
    m.bindPopup('<b>' + (p.num||'') + '</b><br/>' + (p.proj||'') + '<br/><small>' + (p.cli||'') + '</small>');
    m.on('click', function() {
      Object.values(markers).forEach(function(mk){mk.setStyle({fillColor:'#1F3A5F'});});
      m.setStyle({fillColor:'#E85D04'});
      var msg = JSON.stringify({type:'select', id:p.id});
      if (window.ReactNativeWebView){window.ReactNativeWebView.postMessage(msg);}
      else{window.postMessage(msg,'*');}
    });
    m.addTo(map);
    markers[p.id] = m;
    latlngs.push([p.lat, p.lng]);
  });
  if (latlngs.length === 1) {
    map.setView(latlngs[0], 13);
  } else {
    map.fitBounds(latlngs, {padding:[40,40]});
  }
}
</script>
</body>
</html>`;

// Module-level constant — stable reference prevents WebView reload on re-render
const COMMUNITY_MAP_SOURCE = { html: COMMUNITY_MAP_HTML };

function buildPinData(jobs) {
  return jobs.map(j => {
    const coords = resolveJobCoords(j);
    if (!coords) return null;
    return { id: j.id, lat: coords.lat, lng: coords.lng,
             num: j.job_number || '', proj: j.project_name || '', cli: j.client_name || '' };
  }).filter(Boolean);
}

function CommunityMapView({ jobs, focusJob, onSelectJob }) {
  const [mapReady, setMapReady] = useState(false); // useState so useEffect re-fires
  const webViewRef = React.useRef(null);

  function inject(js) { webViewRef.current?.injectJavaScript(js + '; true;'); }

  // Load all pins whenever jobs change or map becomes ready
  React.useEffect(() => {
    if (!mapReady) return;
    const pins = buildPinData(jobs);
    inject(`loadPins(${JSON.stringify(pins)})`);
  }, [jobs, mapReady]);

  // Fly to focused job (long-press)
  React.useEffect(() => {
    if (!mapReady || !focusJob) return;
    const coords = resolveJobCoords(focusJob);
    if (!coords) return;
    inject(`map.flyTo([${coords.lat},${coords.lng}],13,{animate:true,duration:0.8})`);
  }, [focusJob, mapReady]);

  function onMapLoad() {
    setTimeout(() => setMapReady(true), 600);
  }

  function handleMessage(e) {
    try {
      const d = JSON.parse(e.nativeEvent?.data || e.data || '');
      if (d.type === 'select' && d.id) onSelectJob?.(d.id);
    } catch {}
  }

  const { WebView } = require('react-native-webview');
  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={webViewRef}
        source={COMMUNITY_MAP_SOURCE}
        style={{ flex: 1 }}
        onLoad={onMapLoad}
        javaScriptEnabled
        originWhitelist={['*']}
        onMessage={handleMessage}
      />
    </View>
  );
}

const C = { navy:'#1F3A5F', blue:'#2E75B6', bg:'#F8FAFC', white:'#fff',
            border:'#CBD5E1', muted:'#64748B', text:'#1E293B', red:'#DC2626' };


const BLANK = { jobNumber:'', projectName:'', clientName:'', locationName:'',
                latitude:null, longitude:null };

const FIELDS = [
  ['Job Number',    'jobNumber',    'e.g. 10581'],
  ['Project Name*', 'projectName',  'e.g. Pacific Highway Upgrade'],
  ['Client',        'clientName',   'e.g. Transport NSW'],
  ['Address',       'locationName', 'e.g. Woolgoolga to Ballina, NSW'],
];


export default function HomeScreen({ navigation }) {
  const [disclaimer,  setDisclaimer]  = useState(true);
  const [tab,         setTab]         = useState('mine');
  const [jobs,        setJobs]        = useState([]);
  const [mineSearch,  setMineSearch]  = useState('');
  const [commSearch,  setCommSearch]  = useState('');
  const [modal,       setModal]       = useState(false);
  const [editModal,   setEditModal]   = useState(false);
  const [editId,      setEditId]      = useState(null);
  const [form,        setForm]        = useState(BLANK);

  // Community state
  const [community,    setCommunity]    = useState([]);
  const [commLoading,  setCommLoading]  = useState(false);
  const [commError,    setCommError]    = useState('');
  const [focusJob,     setFocusJob]     = useState(null);
  const commListRef = React.useRef(null);

  useFocusEffect(useCallback(() => {
    DB.getJobs().then(setJobs);
  }, []));

  // Load community jobs when tab switches
  useFocusEffect(useCallback(() => {
    if (tab === 'community') loadCommunity();
  }, [tab]));

  async function loadCommunity() {
    setCommLoading(true); setCommError('');
    try {
      const data = await getCommunityJobs();
      setCommunity(data);
    } catch (e) {
      setCommError('Cannot reach Supabase. Check your URL and API key in src/lib/supabase.js');
    } finally {
      setCommLoading(false);
    }
  }

  async function publishJob(job) {
    if (!job.latitude || !job.longitude) {
      Alert.alert('No Location', 'Set a map location for this job before publishing.');
      return;
    }
    try {
      await supabasePublish(job, job.boreholes || []);
      Alert.alert('Published ✓', `"${job.projectName}" is now visible on the Community map.`);
    } catch (e) {
      Alert.alert('Error', 'Could not publish. Check Supabase config.');
    }
  }

  async function openCommunityJob(j) {
    try {
      const detail = await getCommunityJobDetail(j.id);
      if (!detail) { Alert.alert('Error', 'Could not load job details.'); return; }
      // Map Supabase snake_case fields → local camelCase format
      const communityJob = {
        id:           detail.id,
        jobNumber:    detail.job_number,
        projectName:  detail.project_name,
        clientName:   detail.client_name,
        locationName: detail.location_name,
        loggedBy:     detail.logged_by,
        latitude:     detail.latitude,
        longitude:    detail.longitude,
        boreholes:    (detail.boreholes_data || []).map((bh, i) => ({
          id:               `comm_${detail.id}_${i}`,
          ...bh,
        })),
      };
      navigation.navigate('Job', { communityJob, readOnly: true });
    } catch (e) {
      Alert.alert('Error', 'Could not load job details.');
    }
  }

  async function createJob() {
    if (!form.projectName.trim()) { Alert.alert('Required','Enter project name'); return; }
    await DB.createJob(form);
    setModal(false); setForm(BLANK);
    DB.getJobs().then(setJobs);
  }

  function openEdit(job) {
    setEditId(job.id);
    setForm({
      jobNumber:    job.jobNumber    || '',
      projectName:  job.projectName  || '',
      clientName:   job.clientName   || '',
      locationName: job.locationName || '',
      latitude:     job.latitude     || null,
      longitude:    job.longitude    || null,
    });
    setEditModal(true);
  }

  async function saveEdit() {
    if (!form.projectName.trim()) { Alert.alert('Required','Enter project name'); return; }
    await DB.updateJob(editId, form);
    setEditModal(false); setEditId(null); setForm(BLANK);
    DB.getJobs().then(setJobs);
  }

  function deleteJob(id) {
    Alert.alert('Delete Job','Delete this job and all its boreholes?',
      [{ text:'Cancel', style:'cancel' }, { text:'Delete', style:'destructive',
        onPress: async () => { await DB.deleteJob(id); DB.getJobs().then(setJobs); }
      }]);
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.navy} />

      {/* ── Startup Disclaimer ── */}
      <Modal visible={disclaimer} transparent animationType="fade" onRequestClose={() => setDisclaimer(false)}>
        <View style={s.disclaimerOverlay}>
          <View style={s.disclaimerBox}>
            <View style={s.disclaimerHeader}>
              <Text style={s.disclaimerIcon}>⚠</Text>
              <Text style={s.disclaimerTitle}>Internal Testing Only</Text>
            </View>
            <Text style={s.disclaimerBody}>
              This application is for internal testing use only.{'\n\n'}
              All logging data collected must be re-entered into the official software before any formal use.
            </Text>
            <TouchableOpacity style={s.disclaimerBtn} onPress={() => setDisclaimer(false)}>
              <Text style={s.disclaimerBtnTxt}>I Understand</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Header ── */}
      <View style={s.header}>
        <Text style={s.headerTitle}>GeoTechLogger</Text>
        {tab === 'mine' && (
          <TouchableOpacity style={s.addBtn} onPress={() => { setForm(BLANK); setModal(true); }}>
            <Text style={s.addBtnTxt}>+ New Job</Text>
          </TouchableOpacity>
        )}
        {tab === 'community' && (
          <TouchableOpacity style={s.addBtn} onPress={loadCommunity}>
            <Text style={s.addBtnTxt}>↻ Refresh</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Tab bar ── */}
      <View style={s.tabBar}>
        <TouchableOpacity style={[s.tabBtn, tab==='mine' && s.tabBtnActive]}
          onPress={() => setTab('mine')}>
          <Text style={[s.tabTxt, tab==='mine' && s.tabTxtActive]}>📋 My Jobs</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tabBtn, tab==='community' && s.tabBtnActive]}
          onPress={() => setTab('community')}>
          <Text style={[s.tabTxt, tab==='community' && s.tabTxtActive]}>🌐 Community</Text>
        </TouchableOpacity>
      </View>

      {/* ── My Jobs tab ── */}
      {tab === 'mine' && (
        <View style={{flex:1}}>
          <View style={s.searchBar}>
            <TextInput
              style={s.searchInput}
              placeholder="Search job #, project, client, address..."
              placeholderTextColor={C.muted}
              value={mineSearch}
              onChangeText={setMineSearch}
              clearButtonMode="while-editing"
            />
          </View>
          <FlatList
            data={jobs.filter(j => {
              const q = mineSearch.trim().toLowerCase();
              if (!q) return true;
              return (j.jobNumber||'').toLowerCase().includes(q)
                  || (j.projectName||'').toLowerCase().includes(q)
                  || (j.clientName||'').toLowerCase().includes(q)
                  || (j.locationName||'').toLowerCase().includes(q);
            })}
            keyExtractor={j => j.id}
            contentContainerStyle={s.list}
            ListEmptyComponent={
              <View style={s.empty}>
                {mineSearch ? (
                  <Text style={s.emptyTxt}>No results for "{mineSearch}"</Text>
                ) : (
                  <>
                    <Text style={s.emptyTxt}>No jobs yet</Text>
                    <Text style={s.emptySub}>Tap + New Job to get started</Text>
                  </>
                )}
              </View>
            }
            renderItem={({ item:j }) => (
              <TouchableOpacity style={s.card}
                onPress={() => navigation.navigate('Job', { jobId: j.id })}>
                <View style={{flex:1}}>
                  <Text style={s.cardJobNum}>{j.jobNumber || '—'}</Text>
                  <Text style={s.cardTitle}>{j.projectName}</Text>
                  {j.clientName ? <Text style={s.cardSub}>{j.clientName}</Text> : null}
                  {j.locationName ? <Text style={s.cardSub}>{j.locationName}</Text> : null}
                  {j.latitude ? (
                    <Text style={s.cardGps}>📍 {j.latitude.toFixed(4)}, {j.longitude.toFixed(4)}</Text>
                  ) : null}
                  <Text style={s.cardBadge}>{(j.boreholes||[]).length} boreholes</Text>
                </View>
                <View style={s.actions}>
                  <TouchableOpacity onPress={() => publishJob(j)} style={s.iconBtn}>
                    <Text style={s.pubTxt}>↑</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => openEdit(j)} style={s.iconBtn}>
                    <Text style={s.editTxt}>✎</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => deleteJob(j.id)} style={s.iconBtn}>
                    <Text style={s.delTxt}>✕</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* ── Community tab ── */}
      {tab === 'community' && (
        <View style={{flex:1}}>
          {commLoading && (
            <View style={s.commLoader}>
              <ActivityIndicator size="large" color={C.blue} />
              <Text style={{color:C.muted, marginTop:8}}>Loading community data…</Text>
            </View>
          )}
          {commError ? (
            <View style={s.commLoader}>
              <Text style={s.errTxt}>{commError}</Text>
              <TouchableOpacity style={[s.addBtn,{marginTop:12}]} onPress={loadCommunity}>
                <Text style={s.addBtnTxt}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : !commLoading && (
            <View style={{flex:1}}>
              {/* Map */}
              <View style={s.mapBox}>
                <CommunityMapView
                  jobs={community}
                  focusJob={focusJob}
                  onSelectJob={id => {
                    const idx = community.findIndex(j => j.id === id);
                    if (idx < 0) return;
                    const j = community[idx];
                    const coords = resolveJobCoords(j);
                    setFocusJob(coords ? { ...j, latitude: coords.lat, longitude: coords.lng } : j);
                    commListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0 });
                  }}
                />
              </View>

              {/* Search bar */}
              <View style={s.searchBar}>
                <TextInput
                  style={s.searchInput}
                  placeholder="Search job #, project, client, address..."
                  placeholderTextColor={C.muted}
                  value={commSearch}
                  onChangeText={setCommSearch}
                  clearButtonMode="while-editing"
                />
              </View>

              {/* Job list */}
              <FlatList
                ref={commListRef}
                data={community.filter(j => {
                  const q = commSearch.trim().toLowerCase();
                  if (!q) return true;
                  return (j.job_number||'').toLowerCase().includes(q)
                      || (j.project_name||'').toLowerCase().includes(q)
                      || (j.client_name||'').toLowerCase().includes(q)
                      || (j.location_name||'').toLowerCase().includes(q);
                })}
                keyExtractor={(j,i) => j.id || String(i)}
                style={s.commList}
                onScrollToIndexFailed={() => {}}
                ListEmptyComponent={
                  <View style={{padding:24, alignItems:'center'}}>
                    {commSearch ? (
                      <Text style={s.emptyTxt}>No results for "{commSearch}"</Text>
                    ) : (
                      <>
                        <Text style={s.emptyTxt}>No published jobs yet</Text>
                        <Text style={s.emptySub}>Use ↑ on your jobs to share them here</Text>
                      </>
                    )}
                  </View>
                }
                renderItem={({ item:j }) => {
                  const isFocused = focusJob?.id === j.id;
                  const coords    = resolveJobCoords(j);
                  return (
                    <TouchableOpacity
                      style={[s.commCard, isFocused && s.commCardFocused]}
                      onPress={() => openCommunityJob(j)}
                      onLongPress={() => coords && setFocusJob({ ...j, latitude: coords.lat, longitude: coords.lng })}
                      delayLongPress={400}
                    >
                      <View style={[s.commDot, isFocused && s.commDotFocused]} />
                      <View style={{flex:1}}>
                        <Text style={s.commTitle}>{j.job_number}</Text>
                        <Text style={s.commProject}>{j.project_name}</Text>
                        <Text style={s.commSub}>{j.client_name}{j.location_name ? '  |  '+j.location_name : ''}</Text>
                        <Text style={s.commSub}>
                          {j.borehole_count||0} boreholes
                          {!coords ? '  ·  no GPS' : ''}
                        </Text>
                      </View>
                      <Text style={s.commArrow}>{isFocused ? '📍' : '›'}</Text>
                    </TouchableOpacity>
                  );
                }}
              />
            </View>
          )}
        </View>
      )}

      {/* ── Create Modal ── */}
      <JobFormModal
        visible={modal} title="New Job"
        form={form} setForm={setForm}
        onCancel={() => setModal(false)}
        onSubmit={createJob} submitLabel="Create Job"
      />

      {/* ── Edit Modal ── */}
      <JobFormModal
        visible={editModal} title="Edit Project Info"
        form={form} setForm={setForm}
        onCancel={() => setEditModal(false)}
        onSubmit={saveEdit} submitLabel="Save Changes"
      />
    </SafeAreaView>
  );
}

function JobFormModal({ visible, title, form, setForm, onCancel, onSubmit, submitLabel }) {
  const [showMap, setShowMap] = useState(false);
  const hasLocation = form.latitude != null && form.longitude != null;

  // When modal closes, reset map view
  React.useEffect(() => { if (!visible) setShowMap(false); }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent={!showMap}
      onRequestClose={showMap ? () => setShowMap(false) : onCancel}>

      {showMap ? (
        // ── Full-screen map embedded inside this same modal ──
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
        // ── Normal form sheet ──
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>{title}</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {FIELDS.map(([lbl, key, ph]) => (
                <View key={key} style={s.field}>
                  <Text style={s.label}>{lbl}</Text>
                  <TextInput style={s.input} placeholder={ph} value={form[key]}
                    onChangeText={v => setForm(f => ({...f,[key]:v}))} />
                </View>
              ))}
              <View style={s.field}>
                <Text style={s.label}>Site Location (GIS)</Text>
                <TouchableOpacity
                  style={[s.mapBtn, hasLocation && s.mapBtnSet]}
                  onPress={() => setShowMap(true)}>
                  <Text style={s.mapBtnTxt}>
                    {hasLocation
                      ? `📍 ${form.latitude.toFixed(5)},  ${form.longitude.toFixed(5)}`
                      : '🗺  Tap to pin location on map'}
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
  header:       { flexDirection:'row', alignItems:'center', padding:16, paddingTop:8, backgroundColor:C.navy },
  headerTitle:  { flex:1, color:'#fff', fontSize:18, fontWeight:'bold' },
  addBtn:       { backgroundColor:'#fff', paddingHorizontal:14, paddingVertical:7, borderRadius:8 },
  addBtnTxt:    { color:C.navy, fontWeight:'bold', fontSize:13 },

  tabBar:       { flexDirection:'row', backgroundColor:C.navy, paddingHorizontal:12, paddingBottom:8 },
  tabBtn:       { flex:1, paddingVertical:8, borderRadius:8, alignItems:'center' },
  tabBtnActive: { backgroundColor:'rgba(255,255,255,0.15)' },
  tabTxt:       { color:'rgba(255,255,255,0.55)', fontSize:13, fontWeight:'600' },
  tabTxtActive: { color:'#fff' },

  // Search bar
  searchBar:    { backgroundColor:C.navy, paddingHorizontal:12, paddingBottom:10, paddingTop:4 },
  searchInput:  { backgroundColor:'rgba(255,255,255,0.15)', borderRadius:10, paddingHorizontal:14,
                  paddingVertical:9, color:'#fff', fontSize:13 },

  list:         { padding:12, backgroundColor:C.bg, flexGrow:1 },
  card:         { backgroundColor:C.white, borderRadius:10, padding:14, marginBottom:10,
                  borderWidth:1, borderColor:C.border, flexDirection:'row', alignItems:'flex-start' },
  cardJobNum:   { fontSize:16, fontWeight:'bold', color:C.navy, marginBottom:1 },
  cardTitle:    { fontSize:13, color:C.text, marginBottom:2 },
  cardSub:      { fontSize:12, color:C.muted, marginBottom:1 },
  cardGps:      { fontSize:11, color:C.blue, marginTop:2 },
  cardBadge:    { marginTop:4, fontSize:11, color:C.blue, fontWeight:'600' },
  actions:      { flexDirection:'row', gap:4, alignItems:'center' },
  iconBtn:      { padding:6 },
  pubTxt:       { color:'#16A34A', fontSize:18, fontWeight:'bold' },
  editTxt:      { color:C.blue, fontSize:17 },
  delTxt:       { color:C.red, fontSize:16 },
  empty:        { alignItems:'center', paddingVertical:60 },
  emptyTxt:     { fontSize:16, fontWeight:'600', color:C.muted },
  emptySub:     { fontSize:12, color:C.muted, marginTop:4 },

  // Community
  mapBox:       { height:280, backgroundColor:'#e5e5e5' },
  commList:     { flex:1, backgroundColor:C.bg },
  commCard:     { flexDirection:'row', alignItems:'flex-start', padding:12,
                  borderBottomWidth:1, borderBottomColor:C.border, backgroundColor:C.white },
  commDot:        { width:8, height:8, borderRadius:4, backgroundColor:C.blue, marginTop:5, marginRight:10 },
  commCardFocused:{ backgroundColor:'#EFF6FF', borderLeftWidth:3, borderLeftColor:C.blue },
  commDotFocused: { backgroundColor:C.navy, width:10, height:10, borderRadius:5 },
  commTitle:    { fontSize:14, fontWeight:'700', color:C.navy },
  commProject:  { fontSize:12, color:C.text, marginTop:1, marginBottom:1 },
  commSub:      { fontSize:11, color:C.muted, marginTop:1 },
  commArrow:    { color:C.muted, fontSize:20, alignSelf:'center', paddingLeft:8 },
  commLoader:   { flex:1, justifyContent:'center', alignItems:'center', backgroundColor:C.bg },
  errTxt:       { color:C.red, fontSize:13, textAlign:'center', paddingHorizontal:24 },

  overlay:      { flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'flex-end' },
  sheet:        { backgroundColor:C.white, borderTopLeftRadius:16, borderTopRightRadius:16,
                  padding:20, paddingBottom:40, maxHeight:'85%' },
  sheetTitle:   { fontSize:18, fontWeight:'bold', color:C.navy, marginBottom:16 },
  field:        { marginBottom:12 },
  label:        { fontSize:12, fontWeight:'600', color:C.muted, marginBottom:4 },
  input:        { borderWidth:1.5, borderColor:C.border, borderRadius:8, padding:10, fontSize:13 },
  row:          { flexDirection:'row', gap:10, marginTop:12 },
  btnOutline:   { flex:1, borderWidth:1.5, borderColor:C.blue, borderRadius:8, padding:12, alignItems:'center' },
  btnOutlineTxt:{ color:C.blue, fontWeight:'600' },
  btnPrimary:   { flex:1, backgroundColor:C.blue, borderRadius:8, padding:12, alignItems:'center' },
  btnPrimaryTxt:{ color:'#fff', fontWeight:'600' },
  mapBtn:       { borderWidth:1.5, borderColor:C.border, borderRadius:8, padding:12,
                  backgroundColor:C.white, alignItems:'center' },
  mapBtnSet:    { borderColor:C.blue, backgroundColor:'#EFF6FF' },
  mapBtnTxt:    { fontSize:13, color:C.muted },

  // Startup disclaimer
  disclaimerOverlay: { flex:1, backgroundColor:'rgba(0,0,0,0.6)', alignItems:'center', justifyContent:'center', padding:24 },
  disclaimerBox:     { backgroundColor:'#fff', borderRadius:14, padding:24, width:'100%', maxWidth:400,
                       borderTopWidth:4, borderColor:'#D97706' },
  disclaimerHeader:  { flexDirection:'row', alignItems:'center', gap:10, marginBottom:14 },
  disclaimerIcon:    { fontSize:22, color:'#D97706' },
  disclaimerTitle:   { fontSize:17, fontWeight:'bold', color:'#1E293B' },
  disclaimerBody:    { fontSize:13, color:'#374151', lineHeight:20, marginBottom:10 },
  disclaimerBodyCn:  { display: 'none' },
  disclaimerBtn:     { backgroundColor:C.navy, borderRadius:10, paddingVertical:14, alignItems:'center' },
  disclaimerBtnTxt:  { color:'#fff', fontWeight:'bold', fontSize:15 },
});
