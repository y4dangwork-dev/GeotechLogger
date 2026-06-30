/**
 * GenerateLogsModal
 *
 * Two-step modal for generating a combined borehole report PDF:
 *   Step 1 — Site Plan: interactive Google Earth / Leaflet WebView
 *             + toggle to include/skip the site plan in the export
 *   Step 2 — Select Boreholes: checklist, select-all / none
 *             + "Generate PDF" button that merges everything
 *
 * Output order: [Site Plan] → [BH-01 log] → [BH-02 log] → …
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert, Switch, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { buildPdfHtml, buildPins, SITE_PLAN_SOURCE } from './SitePlanModal';
import { renderBorehole } from '../renderer/pdfRenderer';

const C = {
  navy: '#1F3A5F', blue: '#2E75B6', bg: '#F8FAFC', white: '#fff',
  border: '#CBD5E1', muted: '#64748B', text: '#1E293B', green: '#16A34A',
};

export default function GenerateLogsModal({ visible, job, boreholes, onClose }) {
  const [step,            setStep]            = useState(1);       // 1 | 2
  const [includeSitePlan, setIncludeSitePlan] = useState(true);
  const [selected,        setSelected]        = useState({});      // { [bhId]: bool }
  const [mapReady,        setMapReady]        = useState(false);
  const [editMode,        setEditMode]        = useState('none'); // 'none'|'draw'|'label'
  const [customBbox,      setCustomBbox]      = useState(null);
  const [annotations,     setAnnotations]     = useState([]);
  const [annCount,        setAnnCount]        = useState(0);
  const [labelPrompt,     setLabelPrompt]     = useState(null); // {lat,lng,idx?,existing?}
  const [labelInput,      setLabelInput]      = useState('');
  const [labelRotation,   setLabelRotation]   = useState(0);
  const [generating,      setGenerating]      = useState(false);
  const [progress,        setProgress]        = useState('');
  const webViewRef = useRef(null);

  const bhs     = boreholes || [];
  const pins    = job ? buildPins(job, bhs) : [];
  const hasGPS  = pins.length > 0;

  // Reset every time the modal opens
  useEffect(() => {
    if (!visible) return;
    const sel = {};
    bhs.forEach(bh => { sel[bh.id] = true; });
    setSelected(sel);
    setStep(1);
    setIncludeSitePlan(hasGPS);
    setMapReady(false);
    setGenerating(false);
    setProgress('');
    setEditMode('none');
    setCustomBbox(null);
    setAnnotations([]);
    setAnnCount(0);
    setLabelPrompt(null);
    setLabelInput('');
  }, [visible]);

  // Inject pins when map ready (step 1 only)
  useEffect(() => {
    if (!mapReady || step !== 1 || !visible) return;
    webViewRef.current?.injectJavaScript(
      `loadSitePlan(${JSON.stringify(pins)}); true;`
    );
  }, [mapReady, step, visible]);

  function inject(js) {
    webViewRef.current?.injectJavaScript(js + '; true;');
  }

  function handleMapMessage(e) {
    try {
      const data = JSON.parse(e.nativeEvent?.data || e.data || '');
      if (data.type === 'bboxSet' || data.type === 'bboxUpdating') {
        setCustomBbox(data.bbox);
        if (data.type === 'bboxSet') setEditMode('none');
      } else if (data.type === 'annotationAdded') {
        setAnnCount(data.count);
      } else if (data.type === 'reset') {
        setCustomBbox(null);
        setAnnotations([]);
        setAnnCount(0);
        setEditMode('none');
      } else if (data.type === 'exportState') {
        setAnnotations(data.annotations || []);
        setCustomBbox(data.customBbox || null);
      } else if (data.type === 'labelRequest') {
        setLabelInput('');
        setLabelRotation(0);
        setLabelPrompt({ lat: data.lat, lng: data.lng });
      } else if (data.type === 'editLabel') {
        setLabelInput(data.text || '');
        setLabelRotation(data.rotation || 0);
        setLabelPrompt({ lat: data.lat, lng: data.lng, idx: data.idx, existing: data.text });
      }
    } catch {}
  }

  function confirmLabel() {
    const text = labelInput.trim();
    if (!text) { setLabelPrompt(null); return; }
    if (labelPrompt?.idx != null) {
      inject(`updateLabel(${labelPrompt.idx}, ${JSON.stringify(text)}, ${labelRotation})`);
    } else {
      inject(`placeLabel(${labelPrompt.lat}, ${labelPrompt.lng}, ${JSON.stringify(text)}, ${labelRotation})`);
    }
    setLabelPrompt(null);
    setLabelInput('');
    setLabelRotation(0);
  }

  function activateMode(mode) {
    if (editMode === mode) {
      inject('setMode("none")');
      setEditMode('none');
    } else {
      inject('setMode("' + mode + '")');
      setEditMode(mode);
    }
  }

  function resetEdits() {
    inject('resetCustomArea()');
    setCustomBbox(null);
    setAnnotations([]);
    setAnnCount(0);
    setEditMode('none');
  }

  function toggleBh(id) {
    setSelected(s => ({ ...s, [id]: !s[id] }));
  }

  function selectAll() {
    const sel = {};
    bhs.forEach(bh => { sel[bh.id] = true; });
    setSelected(sel);
  }

  function selectNone() {
    const sel = {};
    bhs.forEach(bh => { sel[bh.id] = false; });
    setSelected(sel);
  }

  const selectedBhs  = bhs.filter(bh => selected[bh.id]);
  const totalFiles   = selectedBhs.length + (includeSitePlan && hasGPS ? 1 : 0);
  const canGenerate  = totalFiles > 0;

  async function generate() {
    if (!canGenerate) {
      Alert.alert('Nothing selected', 'Include site plan or tick at least one borehole.');
      return;
    }
    setGenerating(true);
    try {
      const { PDFDocument } = require('pdf-lib');
      const Print      = require('expo-print');
      const FileSystem = require('expo-file-system/legacy');
      const Sharing    = require('expo-sharing');

      const merged = await PDFDocument.create();

      // ── 1. Site Plan ──────────────────────────────────────────────────────
      if (includeSitePlan && hasGPS) {
        setProgress('Generating site plan…');
        // Capture current annotations from WebView before building
        inject('getExportState()');
        await new Promise(r => setTimeout(r, 200)); // brief wait for message
        const html = buildPdfHtml(job, bhs, pins, customBbox, annotations);
        if (html) {
          // iOS: WebKit respects @page CSS (1056×816 CSS px = Letter landscape at 96dpi)
          // Android: uses these as 72dpi print points → 792×612 = 11"×8.5" Letter landscape
          const pW = Platform.OS === 'ios' ? 1056 : 792;
          const pH = Platform.OS === 'ios' ? 816  : 612;
          const { uri } = await Print.printToFileAsync({ html, base64: false, width: pW, height: pH });
          const b64 = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          const doc   = await PDFDocument.load(bytes);
          const pages = await merged.copyPages(doc, doc.getPageIndices());
          pages.forEach(p => merged.addPage(p));
        }
      }

      // ── 2. Borehole logs ──────────────────────────────────────────────────
      for (let i = 0; i < selectedBhs.length; i++) {
        const bh = selectedBhs[i];
        setProgress(`Generating ${bh.boreholeNumber || 'BH'} (${i + 1}/${selectedBhs.length})…`);
        const bytes = await renderBorehole(job, bh);
        const doc   = await PDFDocument.load(bytes);
        const pages = await merged.copyPages(doc, doc.getPageIndices());
        pages.forEach(p => merged.addPage(p));
      }

      // ── 3. Save & share ───────────────────────────────────────────────────
      setProgress('Saving…');
      const outBytes = await merged.save();

      // Chunk to avoid stack overflow on large PDFs
      let binary = '';
      const CHUNK = 8192;
      for (let i = 0; i < outBytes.length; i += CHUNK) {
        binary += String.fromCharCode(...outBytes.subarray(i, i + CHUNK));
      }
      const outB64 = btoa(binary);
      const fname  = `${job?.jobNumber || 'export'}_BoreholeLog.pdf`;
      const path   = FileSystem.cacheDirectory + fname;
      await FileSystem.writeAsStringAsync(path, outB64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'application/pdf', dialogTitle: fname });
      } else {
        Alert.alert('Saved', `PDF saved to:\n${path}`);
      }
    } catch (err) {
      Alert.alert('Export failed', String(err));
    } finally {
      setGenerating(false);
      setProgress('');
    }
  }

  const { WebView } = require('react-native-webview');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.safe}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        {/* ── Step indicator ─────────────────────────────────────────────── */}
        <View style={s.steps}>
          <View style={[s.stepDot, step === 1 && s.stepDotActive]} />
          <View style={s.stepLine} />
          <View style={[s.stepDot, step === 2 && s.stepDotActive]} />
        </View>

        {/* ══ STEP 1: Site Plan ═══════════════════════════════════════════ */}
        {step === 1 && (
          <View style={{ flex: 1 }}>
            {/* Include toggle */}
            <View style={s.toggleRow}>
              <Text style={s.toggleLabel}>Include site plan in export</Text>
              <Switch
                value={includeSitePlan}
                onValueChange={setIncludeSitePlan}
                trackColor={{ false: '#ccc', true: C.blue }}
                thumbColor="#fff"
              />
            </View>

            {/* ── Edit toolbar ── */}
            {hasGPS && (
              <View style={s.editToolbar}>
                <TouchableOpacity
                  style={[s.editBtn, editMode==='draw' && s.editBtnActive]}
                  onPress={() => activateMode('draw')}>
                  <Text style={[s.editBtnTxt, editMode==='draw' && s.editBtnTxtActive]}>
                    {customBbox ? '✓ Area Set' : '□ Draw Area'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.editBtn, editMode==='label' && s.editBtnActive]}
                  onPress={() => activateMode('label')}>
                  <Text style={[s.editBtnTxt, editMode==='label' && s.editBtnTxtActive]}>
                    {annCount > 0 ? `✓ ${annCount} Label${annCount>1?'s':''}` : 'A Label'}
                  </Text>
                </TouchableOpacity>
                {(customBbox || annCount > 0) && (
                  <TouchableOpacity style={s.editBtnReset} onPress={resetEdits}>
                    <Text style={s.editBtnResetTxt}>↺ Reset</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {editMode !== 'none' && (
              <View style={s.editHint}>
                <Text style={s.editHintTxt}>
                  {editMode === 'draw'
                    ? 'Drag on map to frame the export area'
                    : 'Tap any map location to add a text label'}
                </Text>
              </View>
            )}
            {hasGPS ? (
              <WebView
                ref={webViewRef}
                source={SITE_PLAN_SOURCE}
                style={{ flex: 1 }}
                onLoad={() => setTimeout(() => setMapReady(true), 700)}
                javaScriptEnabled
                originWhitelist={['*']}
                onMessage={handleMapMessage}
              />
            ) : (
              <View style={s.noGps}>
                <Text style={s.noGpsIcon}>📍</Text>
                <Text style={s.noGpsTxt}>No GPS data — site plan unavailable</Text>
                <Text style={s.noGpsSub}>Add GPS coordinates to the job or boreholes</Text>
              </View>
            )}

            {/* ── Step 1 footer: Cancel + Next ───────────────────────────── */}
            <View style={s.nextFooter}>
              <TouchableOpacity style={s.backBtn} onPress={onClose}>
                <Text style={s.backBtnTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.nextBtn} onPress={() => setStep(2)}>
                <Text style={s.nextTxt}>Next  →</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ══ STEP 2: Select Boreholes ════════════════════════════════════ */}
        {step === 2 && (
          <View style={{ flex: 1 }}>
            {/* Selection header */}
            <View style={s.selHeader}>
              <Text style={s.selCount}>
                {selectedBhs.length} / {bhs.length} boreholes selected
                {includeSitePlan && hasGPS ? '  +  site plan' : ''}
              </Text>
              <View style={s.selActions}>
                <TouchableOpacity onPress={selectAll}  style={s.selBtn}>
                  <Text style={s.selBtnTxt}>All</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={selectNone} style={s.selBtn}>
                  <Text style={s.selBtnTxt}>None</Text>
                </TouchableOpacity>
              </View>
            </View>

            {bhs.length === 0 ? (
              <View style={s.empty}>
                <Text style={s.emptyTxt}>No boreholes in this job</Text>
              </View>
            ) : (
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
                {bhs.map(bh => (
                  <TouchableOpacity
                    key={bh.id}
                    style={[s.bhRow, selected[bh.id] && s.bhRowSelected]}
                    onPress={() => toggleBh(bh.id)}
                    activeOpacity={0.7}
                  >
                    <View style={[s.checkbox, selected[bh.id] && s.checkboxChecked]}>
                      {selected[bh.id] && <Text style={s.checkmark}>✓</Text>}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.bhName}>{bh.boreholeNumber || bh.id}</Text>
                      <Text style={s.bhSub}>
                        {[bh.date, bh.datum].filter(Boolean).join('  ·  ')}
                        {bh.groundwaterDepth ? `  ·  GW ${bh.groundwaterDepth}m` : ''}
                      </Text>
                    </View>
                    <Text style={s.bhEntries}>{(bh.entries || []).length} entries</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {/* ── Footer: Back + Generate ─────────────────────────────────── */}
            <View style={s.genFooter}>
              <TouchableOpacity style={s.backBtn} onPress={() => setStep(1)}>
                <Text style={s.backBtnTxt}>← Back</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.genBtn, (!canGenerate || generating) && s.genBtnDisabled]}
                onPress={generate}
                disabled={!canGenerate || generating}
              >
                {generating ? (
                  <View style={s.genBtnInner}>
                    <ActivityIndicator size="small" color="#fff" />
                    <Text style={s.genBtnTxt}>{progress || '…'}</Text>
                  </View>
                ) : (
                  <Text style={s.genBtnTxt}>
                    Generate PDF  ({totalFiles} {totalFiles === 1 ? 'file' : 'files'})
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Native label input modal ── */}
        <Modal
          visible={!!labelPrompt}
          transparent
          animationType="fade"
          onRequestClose={() => setLabelPrompt(null)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={s.labelOverlay}
          >
            <View style={s.labelBox}>
              <Text style={s.labelBoxTitle}>
                {labelPrompt?.idx != null ? 'Edit Label' : 'Add Label'}
              </Text>
              <TextInput
                style={s.labelInput}
                value={labelInput}
                onChangeText={setLabelInput}
                placeholder="Enter label text..."
                placeholderTextColor="#94A3B8"
                autoFocus
                returnKeyType="done"
                onSubmitEditing={confirmLabel}
              />
              <View style={s.rotRow}>
                <TouchableOpacity style={s.rotBtn} onPress={() => setLabelRotation(r => r - 15)}>
                  <Text style={s.rotBtnTxt}>↺ −15°</Text>
                </TouchableOpacity>
                <Text style={s.rotVal}>{labelRotation}°</Text>
                <TouchableOpacity style={s.rotBtn} onPress={() => setLabelRotation(r => r + 15)}>
                  <Text style={s.rotBtnTxt}>+15° ↻</Text>
                </TouchableOpacity>
              </View>
              <View style={s.labelBtns}>
                <TouchableOpacity style={s.labelCancel} onPress={() => setLabelPrompt(null)}>
                  <Text style={s.labelCancelTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.labelConfirm} onPress={confirmLabel}>
                  <Text style={s.labelConfirmTxt}>✓ Place</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: C.navy },

  nextFooter:    { flexDirection: 'row', gap: 10, padding: 16,
                   backgroundColor: C.white, borderTopWidth: 1, borderColor: C.border },
  nextBtn:       { flex: 1, backgroundColor: C.blue, borderRadius: 10,
                   paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  nextTxt:       { color: '#fff', fontWeight: 'bold', fontSize: 15 },

  // Step indicator
  steps:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                   paddingVertical: 8, backgroundColor: C.navy, gap: 0 },
  stepDot:       { width: 8, height: 8, borderRadius: 4,
                   backgroundColor: 'rgba(255,255,255,0.3)' },
  stepDotActive: { backgroundColor: '#fff' },
  stepLine:      { width: 32, height: 2, backgroundColor: 'rgba(255,255,255,0.25)',
                   marginHorizontal: 4 },

  // Toggle row
  toggleRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                   backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 10,
                   borderBottomWidth: 1, borderColor: C.border },
  toggleLabel:   { fontSize: 14, color: C.text, fontWeight: '500' },

  // No GPS
  noGps:         { flex: 1, alignItems: 'center', justifyContent: 'center',
                   backgroundColor: C.bg },
  noGpsIcon:     { fontSize: 40, marginBottom: 12 },
  noGpsTxt:      { fontSize: 16, color: C.navy, fontWeight: '600', marginBottom: 6 },
  noGpsSub:      { fontSize: 12, color: C.muted, textAlign: 'center', paddingHorizontal: 32 },

  // Borehole selection
  selHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                   backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 10,
                   borderBottomWidth: 1, borderColor: C.border },
  selCount:      { fontSize: 13, color: C.navy, fontWeight: '600', flex: 1 },
  selActions:    { flexDirection: 'row', gap: 8 },
  selBtn:        { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 6,
                   borderWidth: 1, borderColor: C.blue },
  selBtnTxt:     { color: C.blue, fontSize: 12, fontWeight: '600' },

  bhRow:         { flexDirection: 'row', alignItems: 'center', backgroundColor: C.white,
                   borderRadius: 10, padding: 14, marginBottom: 8,
                   borderWidth: 1.5, borderColor: C.border, gap: 12 },
  bhRowSelected: { borderColor: C.blue, backgroundColor: '#EFF6FF' },
  checkbox:      { width: 22, height: 22, borderRadius: 5, borderWidth: 2,
                   borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center',
                   backgroundColor: '#fff' },
  checkboxChecked:{ borderColor: C.blue, backgroundColor: C.blue },
  checkmark:     { color: '#fff', fontSize: 13, fontWeight: 'bold', lineHeight: 16 },
  bhName:        { fontSize: 15, fontWeight: 'bold', color: C.navy },
  bhSub:         { fontSize: 11, color: C.muted, marginTop: 2 },
  bhEntries:     { fontSize: 11, color: C.blue, fontWeight: '600' },

  empty:         { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  emptyTxt:      { fontSize: 15, color: C.muted },

  // Edit toolbar
  editToolbar:    { flexDirection: 'row', alignItems: 'center', gap: 8,
                    backgroundColor: '#F1F5F9', paddingHorizontal: 12, paddingVertical: 8,
                    borderBottomWidth: 1, borderColor: C.border },
  editBtn:        { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 7,
                    borderWidth: 1.5, borderColor: C.blue, backgroundColor: '#fff' },
  editBtnActive:  { backgroundColor: C.blue },
  editBtnTxt:     { color: C.blue, fontSize: 13, fontWeight: '600' },
  editBtnTxtActive:{ color: '#fff' },
  editBtnReset:   { marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 6,
                    borderRadius: 7, borderWidth: 1.5, borderColor: '#DC2626' },
  editBtnResetTxt:{ color: '#DC2626', fontSize: 13, fontWeight: '600' },
  editHint:       { backgroundColor: '#FFF7ED', paddingHorizontal: 14, paddingVertical: 6,
                    borderBottomWidth: 1, borderColor: '#FED7AA' },
  editHintTxt:    { color: '#92400E', fontSize: 12, textAlign: 'center' },

  // Label input modal
  labelOverlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
                    justifyContent: 'center', paddingHorizontal: 32 },
  labelBox:       { backgroundColor: '#fff', borderRadius: 14, padding: 20,
                    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10,
                    shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  labelBoxTitle:  { fontSize: 16, fontWeight: 'bold', color: '#1E293B',
                    marginBottom: 12, textAlign: 'center' },
  labelInput:     { borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 8,
                    paddingHorizontal: 14, paddingVertical: 10, fontSize: 15,
                    color: '#1E293B', marginBottom: 12 },
  rotRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: 14 },
  rotBtn:         { backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE',
                    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  rotBtnTxt:      { color: '#1F3A5F', fontWeight: '600', fontSize: 13 },
  rotVal:         { fontSize: 14, fontWeight: 'bold', color: '#1E293B', minWidth: 44,
                    textAlign: 'center' },
  labelBtns:      { flexDirection: 'row', gap: 10 },
  labelCancel:    { flex: 1, borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 8,
                    paddingVertical: 11, alignItems: 'center' },
  labelCancelTxt: { color: '#64748B', fontWeight: '600', fontSize: 14 },
  labelConfirm:   { flex: 1, backgroundColor: '#1F3A5F', borderRadius: 8,
                    paddingVertical: 11, alignItems: 'center' },
  labelConfirmTxt:{ color: '#fff', fontWeight: 'bold', fontSize: 14 },

  // Generate footer
  genFooter:     { flexDirection: 'row', gap: 10, padding: 16,
                   backgroundColor: C.white, borderTopWidth: 1, borderColor: C.border },
  backBtn:       { borderWidth: 1.5, borderColor: C.blue, borderRadius: 10,
                   paddingVertical: 16, paddingHorizontal: 20,
                   alignItems: 'center', justifyContent: 'center' },
  backBtnTxt:    { color: C.blue, fontWeight: '600', fontSize: 15 },
  genBtn:        { flex: 1, backgroundColor: C.blue, borderRadius: 10,
                   paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  genBtnDisabled:{ opacity: 0.4 },
  genBtnInner:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  genBtnTxt:     { color: '#fff', fontSize: 15, fontWeight: 'bold' },
});
