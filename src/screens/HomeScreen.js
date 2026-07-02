import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, Alert, Modal, StatusBar, Switch,
  ScrollView, ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { DB } from '../storage/db';
import { MapPickerView } from '../components/MapPickerModal';
import { getCommunityJobs, getCommunityJobDetail, publishJob as supabasePublish, unpublishJob, logActivity, isAdmin as checkIsAdmin } from '../lib/supabase';
import { supabase } from '../lib/supabaseClient';

const SYNC_INTERVAL_MS = 10000; // auto-sync Community tab every 10s while focused

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
var searchMarker = null;

function setSearchPin(lat, lng, label) {
  if (searchMarker) { map.removeLayer(searchMarker); searchMarker = null; }
  searchMarker = L.marker([lat, lng], { opacity: 0.9 }).addTo(map);
  if (label) searchMarker.bindPopup(label).openPopup();
}

function clearSearchPin() {
  if (searchMarker) { map.removeLayer(searchMarker); searchMarker = null; }
}

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

function CommunityMapView({ jobs, focusJob, searchPin, onSelectJob }) {
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

  // Fly to + drop a pin on a searched location (e.g. "Sydney", an address, etc.)
  // that isn't necessarily where any published job is.
  React.useEffect(() => {
    if (!mapReady) return;
    if (!searchPin) { inject('clearSearchPin()'); return; }
    const { lat, lng, label } = searchPin;
    inject(`setSearchPin(${lat},${lng},${JSON.stringify(label || '')})`);
    inject(`map.flyTo([${lat},${lng}],13,{animate:true,duration:0.8})`);
  }, [searchPin, mapReady]);

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
  const [jobs,        setJobs]        = useState([]);
  const [mineSearch,  setMineSearch]  = useState('');
  const [modal,       setModal]       = useState(false);
  const [editModal,   setEditModal]   = useState(false);
  const [editId,      setEditId]      = useState(null);
  const [form,        setForm]        = useState(BLANK);

  // Nearby Reference settings
  const [nearbyEnabled, setNearbyEnabled] = useState(false);
  const [nearbyRadius,  setNearbyRadius]  = useState(3);

  // Community tab
  const [tab,           setTab]           = useState('mine'); // 'mine' | 'community'
  const [commJobs,       setCommJobs]      = useState([]);
  const [commSearch,     setCommSearch]    = useState('');
  const [commLoading,    setCommLoading]   = useState(false);
  const [commError,      setCommError]     = useState(null);
  const [focusJob,        setFocusJob]      = useState(null);
  const [deviceId,        setDeviceId]      = useState(null);
  const [userId,          setUserId]        = useState(null); // signed-in user's id (real ownership)
  const [geoResult,       setGeoResult]      = useState(null); // { lat, lng, label } for a searched place
  const [geoLoading,      setGeoLoading]     = useState(false);
  const [isUserAdmin,     setIsUserAdmin]    = useState(false); // this account is on the server admins allow-list
  const [adminMode,       setAdminMode]      = useState(false); // off by default even for admins — must be switched on
  const syncTimerRef = useRef(null);

  useFocusEffect(useCallback(() => {
    DB.getJobs().then(setJobs);
    DB.getSettings().then(s => {
      setNearbyEnabled(s.nearbyRefEnabled);
      setNearbyRadius(s.nearbyRefRadius);
    });
  }, []));

  // Legacy device id — still sent alongside owner_user_id for jobs published
  // before login existed, but ownership is now really decided by owner_user_id
  // (checked both here for UX and, authoritatively, by RLS on the server).
  useEffect(() => { DB.getDeviceId().then(setDeviceId); }, []);
  useEffect(() => {
    supabase.auth.getUser()
      .then(({ data }) => setUserId(data?.user?.id || null))
      .catch(() => setUserId(null)); // e.g. offline — fine, just means no ownership checks apply
  }, []);
  // Ask the server whether this signed-in account is on the admins
  // allow-list (supabase_admin_setup.sql). The allow-list itself never
  // reaches the client — just this yes/no. adminMode stays off even for an
  // admin account until they flip the switch, so an accidental tap on
  // someone else's job can't edit/delete it by mistake.
  useEffect(() => {
    checkIsAdmin().then(setIsUserAdmin).catch(() => setIsUserAdmin(false));
  }, [userId]);

  function toggleNearby(val) {
    setNearbyEnabled(val);
    DB.updateSettings({ nearbyRefEnabled: val });
  }
  function setRadius(r) {
    setNearbyRadius(r);
    DB.updateSettings({ nearbyRefRadius: r });
  }

  // Distance in km between two lat/lng points.
  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // When a text search on Community turns up nothing, try treating it as a
  // place name instead (e.g. "Burnaby", "123 Main St") — geocode it via
  // OpenStreetMap's free Nominatim service (no API key needed), fly the map
  // there, and show any published jobs within 1km of that point.
  async function geocodeCommSearch(query) {
    const q = query.trim();
    if (!q) { setGeoResult(null); return; }
    setGeoLoading(true);
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
        { headers: { 'User-Agent': 'GeoTechLoggerApp (internal geotech field app)' } }
      );
      const rows = await r.json();
      if (!rows.length) {
        setGeoResult({ lat: null, lng: null, label: q });
      } else {
        setGeoResult({ lat: parseFloat(rows[0].lat), lng: parseFloat(rows[0].lon), label: rows[0].display_name || q });
      }
    } catch (e) {
      setGeoResult({ lat: null, lng: null, label: q, error: e.message || 'Could not search location' });
    } finally {
      setGeoLoading(false);
    }
  }

  function onCommSearchSubmit() {
    if (filteredCommJobsForSearch(commSearch, commJobs).length > 0) {
      setGeoResult(null); // exact text matches exist — no need to geocode
      return;
    }
    geocodeCommSearch(commSearch);
  }

  function filteredCommJobsForSearch(query, list) {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(j =>
      (j.job_number||'').toLowerCase().includes(q)
      || (j.project_name||'').toLowerCase().includes(q)
      || (j.client_name||'').toLowerCase().includes(q)
      || (j.location_name||'').toLowerCase().includes(q)
    );
  }

  // ── Community: load + publish + auto-sync every 10s while tab is focused ──
  async function loadCommunity({ silent = false } = {}) {
    if (!silent) setCommLoading(true);
    setCommError(null);
    try {
      const rows = await getCommunityJobs();
      setCommJobs(rows);
    } catch (e) {
      setCommError(e.message || 'Failed to load community jobs');
    } finally {
      if (!silent) setCommLoading(false);
    }
  }

  async function doPublish(job, { isOverwrite = false } = {}) {
    try {
      const boreholes = job.boreholes || [];
      await supabasePublish(job, boreholes, deviceId);
      logActivity({
        jobId: job.id, action: isOverwrite ? 'overwrite' : 'publish', deviceId,
        jobNumber: job.jobNumber, projectName: job.projectName, boreholeCount: boreholes.length,
      });
      Alert.alert('Published', 'Job published to Community map.');
      loadCommunity({ silent: true });
    } catch (e) {
      Alert.alert('Publish Failed', e.message || 'Could not publish job');
    }
  }

  // Real ownership (owner_user_id, checked server-side by RLS) takes priority;
  // owner_device_id is only a fallback for rows published before login existed.
  function isOwnCommunityRecord(record) {
    if (!record) return false;
    // Admin Mode switched on: treat every record as editable/deletable.
    // The server enforces this independently via is_admin() in RLS — this
    // client-side check only controls whether the UI *offers* the buttons.
    if (adminMode && isUserAdmin) return true;
    if (record.owner_user_id) return userId != null && record.owner_user_id === userId;
    if (record.owner_device_id) return deviceId != null && record.owner_device_id === deviceId;
    return false;
  }

  async function publishJob(job) {
    // Publishing is always a manual, explicit action — the server copy is
    // never edited in place. If this job was published before, re-publishing
    // overwrites its Community data (including boreholes), so confirm first.
    let existing = null;
    try { existing = await getCommunityJobDetail(job.id); } catch { /* treat as not-yet-published */ }

    if (existing && (existing.borehole_count || 0) > 0) {
      if ((existing.owner_user_id || existing.owner_device_id) && !isOwnCommunityRecord(existing)) {
        Alert.alert(
          'Not Your Published Job',
          'This job appears to already be published by someone else. Overwriting it from here is not allowed.'
        );
        return;
      }
      Alert.alert(
        'Overwrite Published Data?',
        `This job is already published on the Community map with ${existing.borehole_count} borehole(s). ` +
        'Publishing again will overwrite the existing Community copy with your current local data. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Overwrite', style: 'destructive', onPress: () => doPublish(job, { isOverwrite: true }) },
        ]
      );
      return;
    }

    doPublish(job);
  }

  async function unpublishCommunityJob(j) {
    if ((j.owner_user_id || j.owner_device_id) && !isOwnCommunityRecord(j)) {
      Alert.alert('Not Your Job', 'You can only remove jobs that you published.');
      return;
    }
    Alert.alert('Remove from Community', 'Remove this job from the community map?',
      [{ text:'Cancel', style:'cancel' }, { text:'Remove', style:'destructive',
        onPress: async () => {
          try {
            await unpublishJob(j.id);
            logActivity({
              jobId: j.id, action: 'unpublish', deviceId,
              jobNumber: j.job_number, projectName: j.project_name, boreholeCount: j.borehole_count,
            });
            loadCommunity({ silent: true });
          }
          catch (e) { Alert.alert('Error', e.message || 'Could not remove job'); }
        }
      }]);
  }

  async function openCommunityJob(j) {
    try {
      const detail = await getCommunityJobDetail(j.id);
      // Community jobs are always view-only here — editing happens locally in
      // "My Jobs", then gets pushed back up with the Publish button.
      navigation.navigate('Job', { communityJob: detail || j, readOnly: true });
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not open job');
    }
  }

  // Auto-sync: poll Community list every 10s, only while Community tab is focused.
  // Stops on tab switch / screen blur so it never runs in the background.
  useFocusEffect(useCallback(() => {
    if (tab !== 'community') return undefined;

    loadCommunity();
    syncTimerRef.current = setInterval(() => loadCommunity({ silent: true }), SYNC_INTERVAL_MS);

    return () => {
      if (syncTimerRef.current) {
        clearInterval(syncTimerRef.current);
        syncTimerRef.current = null;
      }
    };
  }, [tab]));

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

  function signOut() {
    Alert.alert('Sign Out', 'Sign out of GeoTechLogger?',
      [{ text:'Cancel', style:'cancel' }, { text:'Sign Out', style:'destructive',
        onPress: () => supabase.auth.signOut().catch(() => {})
      }]);
  }

  const textMatchedCommJobs = filteredCommJobsForSearch(commSearch, commJobs);

  // Jobs within 1km of a geocoded search location (only relevant once a text
  // search comes up empty and we fell back to place-name search).
  const nearbyGeoJobs = (geoResult?.lat != null)
    ? commJobs.filter(j => {
        const c = resolveJobCoords(j);
        if (!c) return false;
        return haversineKm(geoResult.lat, geoResult.lng, c.lat, c.lng) <= 1;
      })
    : [];

  const usingGeoFallback = commSearch.trim() !== '' && textMatchedCommJobs.length === 0 && !!geoResult;
  const filteredCommJobs = usingGeoFallback ? nearbyGeoJobs : textMatchedCommJobs;

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
        <TouchableOpacity style={s.signOutBtn} onPress={signOut}>
          <Text style={s.signOutTxt}>Sign Out</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.addBtn} onPress={() => { setForm(BLANK); setModal(true); }}>
          <Text style={s.addBtnTxt}>+ New Job</Text>
        </TouchableOpacity>
      </View>

      {/* ── Tab Bar ── */}
      <View style={s.tabBar}>
        <TouchableOpacity
          style={[s.tabBtn, tab === 'mine' && s.tabBtnActive]}
          onPress={() => setTab('mine')}>
          <Text style={[s.tabTxt, tab === 'mine' && s.tabTxtActive]}>My Jobs</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tabBtn, tab === 'community' && s.tabBtnActive]}
          onPress={() => setTab('community')}>
          <Text style={[s.tabTxt, tab === 'community' && s.tabTxtActive]}>Community</Text>
        </TouchableOpacity>
      </View>

      {tab === 'community' ? (
        /* ── Community ── */
        <View style={{flex:1}}>
          {isUserAdmin && (
            <View style={s.adminBar}>
              <Text style={s.adminBarTxt}>
                {adminMode ? 'Admin Mode — you can edit/delete any job' : 'Admin Mode'}
              </Text>
              <Switch
                value={adminMode}
                onValueChange={v => {
                  if (v) {
                    Alert.alert(
                      'Turn On Admin Mode?',
                      'You will be able to edit and delete any job published by anyone, not just your own.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Turn On', style: 'destructive', onPress: () => setAdminMode(true) },
                      ]
                    );
                  } else {
                    setAdminMode(false);
                  }
                }}
                trackColor={{ false: '#CBD5E1', true: '#DC2626' }}
                thumbColor="#fff"
              />
            </View>
          )}
          <View style={s.searchBar}>
            <TextInput
              style={s.searchInput}
              placeholder="Search job #, project, client, location... (press enter to search a place)"
              placeholderTextColor={C.muted}
              value={commSearch}
              onChangeText={t => { setCommSearch(t); setGeoResult(null); }}
              onSubmitEditing={onCommSearchSubmit}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            {geoLoading && <ActivityIndicator size="small" color={C.blue} style={{marginLeft:8}} />}
          </View>
          {usingGeoFallback && (
            <View style={s.geoBanner}>
              <Text style={s.geoBannerTxt} numberOfLines={2}>
                {geoResult.lat != null
                  ? `📍 Showing jobs within 1km of "${geoResult.label}"`
                  : geoResult.error
                    ? `Could not search "${geoResult.label}": ${geoResult.error}`
                    : `No location found for "${geoResult.label}"`}
              </Text>
            </View>
          )}
          <View style={s.mapBox}>
            <CommunityMapView
              jobs={filteredCommJobs}
              focusJob={focusJob}
              searchPin={geoResult?.lat != null ? geoResult : null}
              onSelectJob={id => {
                const j = filteredCommJobs.find(x => x.id === id);
                if (j) setFocusJob(j);
              }}
            />
          </View>
          {commLoading ? (
            <View style={s.commLoader}><ActivityIndicator color={C.blue} /></View>
          ) : commError ? (
            <View style={s.commLoader}>
              <Text style={s.errTxt}>{commError}</Text>
              <TouchableOpacity style={[s.btnPrimary,{marginTop:12,paddingHorizontal:20}]} onPress={() => loadCommunity()}>
                <Text style={s.btnPrimaryTxt}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              style={s.commList}
              data={filteredCommJobs}
              keyExtractor={j => j.id}
              ListEmptyComponent={
                <View style={s.empty}>
                  {usingGeoFallback && geoResult.lat != null ? (
                    <>
                      <Text style={s.emptyTxt}>No published jobs within 1km</Text>
                      <Text style={s.emptySub}>of "{geoResult.label}"</Text>
                    </>
                  ) : commSearch ? (
                    geoLoading
                      ? <Text style={s.emptyTxt}>Searching…</Text>
                      : <Text style={s.emptyTxt}>No results for "{commSearch}"</Text>
                  ) : (
                    <>
                      <Text style={s.emptyTxt}>No published jobs yet</Text>
                      <Text style={s.emptySub}>Publish a job from "My Jobs" to see it here</Text>
                    </>
                  )}
                </View>
              }
              renderItem={({ item:j }) => (
                <TouchableOpacity
                  style={[s.commCard, focusJob?.id === j.id && s.commCardFocused]}
                  onPress={() => openCommunityJob(j)}
                  onLongPress={() => setFocusJob(j)}>
                  <View style={[s.commDot, focusJob?.id === j.id && s.commDotFocused]} />
                  <View style={{flex:1}}>
                    <Text style={s.commTitle}>{j.job_number || '—'}</Text>
                    <Text style={s.commProject}>{j.project_name}</Text>
                    {j.client_name ? <Text style={s.commSub}>{j.client_name}</Text> : null}
                    <Text style={s.commSub}>{j.borehole_count || 0} boreholes</Text>
                  </View>
                  {isOwnCommunityRecord(j) && (
                    <TouchableOpacity onPress={() => unpublishCommunityJob(j)} style={s.iconBtn}>
                      <Text style={s.delTxt}>✕</Text>
                    </TouchableOpacity>
                  )}
                  <Text style={s.commArrow}>›</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      ) : (
      /* ── My Jobs ── */
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
          {/* ── Nearby Reference Settings ── */}
          <View style={s.settingsCard}>
            <View style={s.settingsRow}>
              <View style={{flex:1}}>
                <Text style={s.settingsLabel}>Nearby Borehole Reference</Text>
                <Text style={s.settingsSub}>Auto-suggest soil layers from nearby boreholes</Text>
              </View>
              <Switch
                value={nearbyEnabled}
                onValueChange={toggleNearby}
                trackColor={{ false: C.border, true: C.blue }}
                thumbColor={nearbyEnabled ? '#fff' : '#f4f3f4'}
              />
            </View>
            {nearbyEnabled && (
              <View style={s.radiusRow}>
                <Text style={s.radiusLabel}>Search radius:</Text>
                {[1, 3, 5].map(r => (
                  <TouchableOpacity
                    key={r}
                    style={[s.radiusBtn, nearbyRadius === r && s.radiusBtnActive]}
                    onPress={() => setRadius(r)}>
                    <Text style={[s.radiusBtnTxt, nearbyRadius === r && s.radiusBtnTxtActive]}>
                      {r} km
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
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
                    <Text style={s.pubTxt}>⇪</Text>
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
  signOutBtn:   { paddingHorizontal:10, paddingVertical:7, marginRight:8 },
  signOutTxt:   { color:'rgba(255,255,255,0.7)', fontSize:12, textDecorationLine:'underline' },
  adminBar:     { flexDirection:'row', alignItems:'center', justifyContent:'space-between',
                  backgroundColor:'#FEF2F2', paddingHorizontal:14, paddingVertical:8,
                  borderBottomWidth:1, borderBottomColor:'#FCA5A5' },
  adminBarTxt:  { color:'#B91C1C', fontSize:12, fontWeight:'600', flex:1, marginRight:8 },

  tabBar:       { flexDirection:'row', backgroundColor:C.navy, paddingHorizontal:12, paddingBottom:8 },
  tabBtn:       { flex:1, paddingVertical:8, borderRadius:8, alignItems:'center' },
  tabBtnActive: { backgroundColor:'rgba(255,255,255,0.15)' },
  tabTxt:       { color:'rgba(255,255,255,0.55)', fontSize:13, fontWeight:'600' },
  tabTxtActive: { color:'#fff' },

  // Search bar
  searchBar:    { backgroundColor:C.navy, paddingHorizontal:12, paddingBottom:10, paddingTop:4,
                  flexDirection:'row', alignItems:'center' },
  searchInput:  { flex:1, backgroundColor:'rgba(255,255,255,0.15)', borderRadius:10, paddingHorizontal:14,
                  paddingVertical:9, color:'#fff', fontSize:13 },
  geoBanner:    { backgroundColor:'#EFF6FF', paddingHorizontal:14, paddingVertical:8,
                  borderBottomWidth:1, borderBottomColor:C.border },
  geoBannerTxt: { fontSize:12, color:C.navy, fontWeight:'600' },

  // Nearby Reference settings card
  settingsCard:       { backgroundColor:C.white, marginHorizontal:12, marginTop:10, marginBottom:2,
                        borderRadius:10, borderWidth:1, borderColor:C.border, padding:12 },
  settingsRow:        { flexDirection:'row', alignItems:'center' },
  settingsLabel:      { fontSize:13, fontWeight:'600', color:C.text },
  settingsSub:        { fontSize:11, color:C.muted, marginTop:1 },
  radiusRow:          { flexDirection:'row', alignItems:'center', marginTop:10, gap:6 },
  radiusLabel:        { fontSize:12, color:C.muted, marginRight:4 },
  radiusBtn:          { paddingHorizontal:14, paddingVertical:5, borderRadius:16,
                        borderWidth:1, borderColor:C.border, backgroundColor:C.bg },
  radiusBtnActive:    { borderColor:C.blue, backgroundColor:C.blue },
  radiusBtnTxt:       { fontSize:12, color:C.muted, fontWeight:'500' },
  radiusBtnTxtActive: { color:'#fff', fontWeight:'600' },

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
