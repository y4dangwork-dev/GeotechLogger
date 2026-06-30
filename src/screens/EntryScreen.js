import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, Modal,
  StyleSheet, Alert, SafeAreaView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { DB } from '../storage/db';

const C = {
  navy:'#1F3A5F', blue:'#2E75B6', bg:'#F8FAFC', white:'#fff',
  border:'#CBD5E1', muted:'#64748B', text:'#1E293B', red:'#DC2626',
  green:'#16A34A', lightBlue:'#EFF6FF', accent:'#BFDBFE',
};

// ── Taxonomy ──────────────────────────────────────────────────────────────────
const PRIM_MATERIALS  = ['Fill','Topsoil','Peat','Clay','Silt','Sand','Gravel',
                         'Sandstone','Siltstone','Limestone'];
const GEO_UNITS       = ['Bedrock','Glacial Till','Glaciofluvial',
                         'Capilano Sediments','Preload Fill','Fill'];
const SEC_MATERIALS   = ['Fill','Topsoil','Peat','Clay','Silt','Sand','Gravel',
                         'Sandstone','Siltstone','Limestone'];
const AND_PAIRS       = ['Sand and Gravel','Silt and Clay','Sand and Silt',
                         'Clay and Gravel','Gravel and Cobbles'];
const THIRD_MODIFIERS = ['Trace (0–10%)','Some (10–20%)'];

const DENSITIES   = ['Very Loose','Loose','Compact','Dense','Very Dense',
                     'Loose to Compact','Compact to Dense','Dense to Very Dense'];
const STIFFNESSES = ['Very Soft','Soft','Firm','Stiff','Very Stiff','Hard',
                     'Soft to Firm','Firm to Stiff','Stiff to Very Stiff'];
const BEDROCK_CONDS = ['Weathered','Fractured','Competent','Massive'];

const MOISTURES = ['Dry','Dry to Moist','Moist','Wet','Moist to Wet','Saturated'];

const COLORS = [
  'Brown','Dark Brown','Light Brown','Reddish Brown',
  'Grey','Dark Grey','Light Grey','Grey to Light Grey','Bluish Grey',
  'Black','White','Olive','Orange','Yellow','Red',
];

// ── Adjective maps ────────────────────────────────────────────────────────────
const Y_ADJECTIVE = {
  Clay:'Clayey', Silt:'Silty', Sand:'Sandy', Gravel:'Gravelly',
  Peat:'Peaty', Fill:'Fill', Topsoil:'Topsoil',
  Sandstone:'Sandy', Siltstone:'Silty', Limestone:'Limestone',
};

function toSoilCase(str) {
  const lowercase = new Set(['and','to','or','with','some','trace']);
  return str.split(' ').map((w, i) =>
    (i > 0 && lowercase.has(w.toLowerCase())) ? w.toLowerCase() : w.toUpperCase()
  ).join(' ');
}

function getThirdLabel(mod) {
  if (!mod) return '';
  if (mod.startsWith('Trace')) return 'trace';
  if (mod.startsWith('Some'))  return 'some';
  return mod;
}

function getSecStr(sm, smType, andPair) {
  if (smType === '-and') return andPair || sm || '';
  if (smType === '-y')   return sm ? (Y_ADJECTIVE[sm] || sm + 'y') : '';
  return sm || '';
}

// Title:  "SAND and GRAVEL (Fill)"
function composeTitle(pm, geoUnit, sm, smType, andPair) {
  let name = '';
  if (smType === '-and' && (andPair || sm)) {
    name = andPair || sm;
  } else if (smType === '-y' && sm) {
    name = `${Y_ADJECTIVE[sm] || sm + 'y'} ${pm}`;
  } else {
    name = pm || '';
  }
  const caps = toSoilCase(name);
  return geoUnit ? `${caps} (${geoUnit})` : caps;
}

// Description: "SAND and GRAVEL, grey to light grey, loose to compact, moist, trace silt, notes (Fill)"
function composeDescription(pm, geoUnit, sm, smType, andPair, tm, tmMod, color, condition, moisture, notes) {
  let name = '';
  if (smType === '-and' && (andPair || sm)) {
    name = andPair || sm;
  } else if (smType === '-y' && sm) {
    name = `${Y_ADJECTIVE[sm] || sm + 'y'} ${pm}`;
  } else {
    name = pm || '';
  }
  const parts = [];
  if (name)      parts.push(toSoilCase(name));
  if (color)     parts.push(color.toLowerCase());
  if (condition) parts.push(condition.toLowerCase());
  if (moisture)  parts.push(moisture.toLowerCase());
  if (tm)        parts.push(`${getThirdLabel(tmMod)} ${tm.toLowerCase()}`.trim());
  if (notes)     parts.push(notes.trim());
  let result = parts.join(', ');
  if (geoUnit)   result += ` (${geoUnit})`;
  return result;
}

function composeCondition(density, stiffness, bedrock) {
  return [density, stiffness, bedrock].filter(Boolean).join(', ');
}

// ── Dropdown component ────────────────────────────────────────────────────────
function DropdownPicker({ label, options, value, onChange, placeholder, disabled }) {
  const [open,       setOpen]       = useState(false);
  const [othersMode, setOthersMode] = useState(false);
  const [othersText, setOthersText] = useState('');

  const isCustom = !!value && !options.includes(value);

  function select(opt) { onChange(opt); setOpen(false); setOthersMode(false); }
  function clear()     { onChange('');  setOpen(false); setOthersMode(false); }
  function confirmOthers() {
    const t = othersText.trim();
    if (t) { onChange(t); setOpen(false); setOthersMode(false); setOthersText(''); }
  }

  return (
    <View style={s.ddWrap}>
      {!!label && <Text style={s.fieldLabel}>{label}</Text>}
      <TouchableOpacity
        style={[s.ddBtn, disabled && s.ddDisabled]}
        onPress={() => { if (!disabled) { setOthersMode(false); setOpen(true); } }}>
        <Text style={[s.ddBtnTxt, !value && s.ddPlaceholder]} numberOfLines={1}>
          {value || placeholder || 'Select…'}
        </Text>
        <Text style={s.ddArrow}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide"
        onRequestClose={() => { setOpen(false); setOthersMode(false); }}>
        <View style={s.sheetOverlay}>
          <View style={s.sheet}>
            <View style={s.sheetHeader}>
              <Text style={s.sheetTitle}>{label || 'Select'}</Text>
              <TouchableOpacity onPress={() => { setOpen(false); setOthersMode(false); }}>
                <Text style={s.sheetClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {!othersMode ? (
              <ScrollView keyboardShouldPersistTaps="handled">
                {!!value && (
                  <TouchableOpacity style={s.clearRow} onPress={clear}>
                    <Text style={s.clearTxt}>— Clear —</Text>
                  </TouchableOpacity>
                )}
                {options.map(opt => (
                  <TouchableOpacity key={opt}
                    style={[s.optRow, value === opt && s.optRowActive]}
                    onPress={() => select(opt)}>
                    <Text style={[s.optTxt, value === opt && s.optTxtActive]}>{opt}</Text>
                    {value === opt && <Text style={s.optCheck}>✓</Text>}
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[s.optRow, isCustom && s.optRowActive]}
                  onPress={() => { setOthersText(isCustom ? value : ''); setOthersMode(true); }}>
                  <Text style={[s.optTxt, isCustom && s.optTxtActive]}>
                    {isCustom ? `Others: ${value}` : 'Others (custom)…'}
                  </Text>
                  {isCustom && <Text style={s.optCheck}>✓</Text>}
                </TouchableOpacity>
              </ScrollView>
            ) : (
              <View style={s.othersView}>
                <Text style={s.othersHint}>Enter custom value:</Text>
                <TextInput style={s.othersInput} value={othersText}
                  onChangeText={setOthersText} placeholder="Type here…"
                  placeholderTextColor="#94A3B8" autoFocus returnKeyType="done"
                  onSubmitEditing={confirmOthers} />
                <View style={s.othersBtns}>
                  <TouchableOpacity style={s.othersBack} onPress={() => setOthersMode(false)}>
                    <Text style={s.othersBackTxt}>← Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.othersOk} onPress={confirmOthers}>
                    <Text style={s.othersOkTxt}>OK</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

// ── Soil type picker ───────────────────────────────────────────────────────────
function SoilTypePicker({
  pm, setPm, geoUnit, setGeoUnit, showGeo, setShowGeo,
  sm, setSm, smType, setSmType, andPair, setAndPair, showSec, setShowSec,
  tm, setTm, tmMod, setTmMod, showThird, setShowThird,
  disabled,
}) {
  function clearSecondary() {
    setShowSec(false); setSm(''); setSmType(''); setAndPair('');
    setShowThird(false); setTm(''); setTmMod('');
  }
  const secPreview = getSecStr(sm, smType, andPair);

  return (
    <View>
      {/* PRIMARY */}
      <Text style={s.tierLabel}>PRIMARY</Text>
      <DropdownPicker label="Material" options={PRIM_MATERIALS}
        value={pm} onChange={disabled ? ()=>{} : setPm}
        placeholder="Select primary material…" disabled={disabled} />

      <TouchableOpacity style={s.toggleBtn}
        onPress={() => { if (!disabled) setShowGeo(v => !v); }}>
        <Text style={s.toggleTxt}>
          {showGeo ? '▾ Hide Geological Unit' : '▸ Geological Unit (optional)'}
        </Text>
      </TouchableOpacity>
      {showGeo && (
        <View style={s.geoBox}>
          <DropdownPicker label="Geological Unit" options={GEO_UNITS}
            value={geoUnit} onChange={disabled ? ()=>{} : setGeoUnit}
            placeholder="Select geological unit…" disabled={disabled} />
        </View>
      )}

      {/* SECONDARY */}
      <View style={s.tierRow}>
        <Text style={s.tierLabel}>SECONDARY  <Text style={s.tierHint}>(20–50%)</Text></Text>
        {!disabled && !showSec && !!pm && (
          <TouchableOpacity style={s.addBtn} onPress={() => setShowSec(true)}>
            <Text style={s.addTxt}>+ Add</Text>
          </TouchableOpacity>
        )}
        {!disabled && showSec && (
          <TouchableOpacity style={s.removeBtn} onPress={clearSecondary}>
            <Text style={s.removeTxt}>✕ Remove</Text>
          </TouchableOpacity>
        )}
      </View>

      {showSec && (
        <View style={s.tierBox}>
          <DropdownPicker label="Material" options={SEC_MATERIALS}
            value={sm} onChange={disabled ? ()=>{} : (v) => { setSm(v); setAndPair(''); }}
            placeholder="Select material…" disabled={disabled} />

          <Text style={s.fieldLabel}>Modifier Form</Text>
          <View style={s.modTypeBtns}>
            {[
              { key:'-y',   label:'−y form  (Silty, Sandy, Clayey…)   20–35%' },
              { key:'-and', label:'−and form  (Sand and Gravel…)   35–50%' },
            ].map(({ key, label }) => (
              <TouchableOpacity key={key}
                style={[s.modTypeBtn, smType === key && s.modTypeBtnActive]}
                onPress={() => { if (!disabled) { setSmType(smType === key ? '' : key); setAndPair(''); } }}>
                <Text style={[s.modTypeTxt, smType === key && s.modTypeTxtActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {smType === '-and' && (
            <DropdownPicker label="And-pair" options={AND_PAIRS}
              value={andPair} onChange={disabled ? ()=>{} : setAndPair}
              placeholder="Select pair…" disabled={disabled} />
          )}

          {!!secPreview && (
            <View style={s.previewPill}>
              <Text style={s.previewTxt}>→ {toSoilCase(secPreview)}</Text>
            </View>
          )}
        </View>
      )}

      {/* THIRD */}
      <View style={s.tierRow}>
        <Text style={s.tierLabel}>THIRD  <Text style={s.tierHint}>(0–20%)</Text></Text>
        {!disabled && showSec && !showThird && (
          <TouchableOpacity style={s.addBtn} onPress={() => setShowThird(true)}>
            <Text style={s.addTxt}>+ Add</Text>
          </TouchableOpacity>
        )}
        {!disabled && showThird && (
          <TouchableOpacity style={s.removeBtn} onPress={() => {
            setShowThird(false); setTm(''); setTmMod('');
          }}>
            <Text style={s.removeTxt}>✕ Remove</Text>
          </TouchableOpacity>
        )}
      </View>

      {showThird && (
        <View style={s.tierBox}>
          <DropdownPicker label="Material" options={SEC_MATERIALS}
            value={tm} onChange={disabled ? ()=>{} : setTm}
            placeholder="Select material…" disabled={disabled} />
          <DropdownPicker label="Modifier" options={THIRD_MODIFIERS}
            value={tmMod} onChange={disabled ? ()=>{} : setTmMod}
            placeholder="Trace / Some…" disabled={disabled} />
        </View>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function EntryScreen({ route, navigation }) {
  const { jobId, bhId, entryId, readOnly = false, communityEntry } = route.params;
  const isEdit = !!entryId || !!communityEntry;

  const [depthFrom, setDepthFrom] = useState('');
  const [depthTo,   setDepthTo]   = useState('');

  // Soil type
  const [pm,        setPm]        = useState('');
  const [geoUnit,   setGeoUnit]   = useState('');
  const [showGeo,   setShowGeo]   = useState(false);
  const [sm,        setSm]        = useState('');
  const [smType,    setSmType]    = useState('');
  const [andPair,   setAndPair]   = useState('');
  const [showSec,   setShowSec]   = useState(false);
  const [tm,        setTm]        = useState('');
  const [tmMod,     setTmMod]     = useState('');
  const [showThird, setShowThird] = useState(false);

  // Condition
  const [density,   setDensity]   = useState('');
  const [stiffness, setStiffness] = useState('');
  const [bedrock,   setBedrock]   = useState('');

  // Other fields
  const [color,       setColor]       = useState('');
  const [moisture,    setMoisture]    = useState('');
  const [notes,       setNotes]       = useState('');
  const [remarks,     setRemarks]     = useState('');

  // Derived
  const title       = composeTitle(pm, geoUnit, sm, smType, andPair);
  const condition   = composeCondition(density, stiffness, bedrock);
  const description = composeDescription(pm, geoUnit, sm, smType, andPair,
                                         tm, tmMod, color, condition, moisture, notes);

  // ── Restore ──────────────────────────────────────────────────────────────
  function restore(c) {
    if (!c) return;
    if (c.pm)     setPm(c.pm);
    if (c.geoUnit){ setGeoUnit(c.geoUnit); setShowGeo(true); }
    if (c.sm || c.smType) {
      setSm(c.sm||''); setSmType(c.smType||''); setAndPair(c.andPair||'');
      setShowSec(true);
    }
    if (c.tm || c.tmMod) {
      setTm(c.tm||''); setTmMod(c.tmMod||''); setShowThird(true);
    }
    if (c.density)   setDensity(c.density);
    if (c.stiffness) setStiffness(c.stiffness);
    if (c.bedrock)   setBedrock(c.bedrock);
    if (c.color)     setColor(c.color);
  }

  useEffect(() => {
    if (communityEntry) {
      setDepthFrom(String(communityEntry.depthFrom ?? ''));
      setDepthTo(String(communityEntry.depthTo ?? ''));
      restore(communityEntry.soilTypeComponents);
      setMoisture(communityEntry.moisture || '');
      setNotes(communityEntry.notes || '');
      setRemarks(communityEntry.remarks || '');
      return;
    }
    if (!isEdit) return;
    DB.getBorehole(jobId, bhId).then(bh => {
      const e = (bh?.entries || []).find(e => e.id === entryId);
      if (!e) return;
      setDepthFrom(String(e.depthFrom ?? ''));
      setDepthTo(String(e.depthTo ?? ''));
      if (e.soilTypeComponents) restore(e.soilTypeComponents);
      else if (e.soilType) setPm(e.soilType);
      setMoisture(e.moisture || '');
      setNotes(e.notes || '');
      setRemarks(e.remarks || '');
    });
  }, [entryId]);

  // ── Save ─────────────────────────────────────────────────────────────────
  async function save() {
    const df = parseFloat(depthFrom), dt = parseFloat(depthTo);
    if (isNaN(df) || isNaN(dt)) { Alert.alert('Error', 'Enter valid depths'); return; }
    if (dt <= df)                { Alert.alert('Error', 'Depth To must be > Depth From'); return; }
    if (!pm)                     { Alert.alert('Error', 'Select a primary material'); return; }

    const soilTypeComponents = {
      pm, geoUnit, sm, smType, andPair, tm, tmMod,
      density, stiffness, bedrock, color,
    };
    const data = {
      depthFrom: df, depthTo: dt,
      soilType:    title,       // short label used by PDF header
      description,              // full composed description for PDF body
      soilTypeComponents,
      condition,
      moisture, notes, remarks,
    };
    if (isEdit) await DB.updateEntry(jobId, bhId, entryId, data);
    else        await DB.createEntry(jobId, bhId, data);
    navigation.goBack();
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.back}>
          <Text style={s.backTxt}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>
          {readOnly ? 'View Entry' : isEdit ? 'Edit Entry' : 'New Entry'}
        </Text>
        {!readOnly && (
          <TouchableOpacity style={s.saveBtn} onPress={save}>
            <Text style={s.saveBtnTxt}>Save</Text>
          </TouchableOpacity>
        )}
      </View>

      <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':'height'}>
      <ScrollView style={s.scroll} contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled">

        {readOnly && (
          <View style={s.readOnlyBanner}>
            <Text style={s.readOnlyBannerTxt}>👁 View Only — no changes can be made</Text>
          </View>
        )}

        {/* Depth */}
        <Section title="Depth (m)">
          <View style={s.row}>
            <View style={s.half}>
              <Text style={s.fieldLabel}>From</Text>
              <TextInput style={s.input} keyboardType="decimal-pad" placeholder="0.0"
                value={depthFrom} onChangeText={setDepthFrom} editable={!readOnly}
                placeholderTextColor="#94A3B8" />
            </View>
            <View style={s.half}>
              <Text style={s.fieldLabel}>To</Text>
              <TextInput style={s.input} keyboardType="decimal-pad" placeholder="1.0"
                value={depthTo} onChangeText={setDepthTo} editable={!readOnly}
                placeholderTextColor="#94A3B8" />
            </View>
          </View>
        </Section>

        {/* Soil Type */}
        <Section title="Soil Type">
          <SoilTypePicker
            pm={pm} setPm={setPm}
            geoUnit={geoUnit} setGeoUnit={setGeoUnit}
            showGeo={showGeo} setShowGeo={setShowGeo}
            sm={sm} setSm={setSm}
            smType={smType} setSmType={setSmType}
            andPair={andPair} setAndPair={setAndPair}
            showSec={showSec} setShowSec={setShowSec}
            tm={tm} setTm={setTm}
            tmMod={tmMod} setTmMod={setTmMod}
            showThird={showThird} setShowThird={setShowThird}
            disabled={readOnly}
          />
        </Section>

        {/* Color */}
        <Section title="Color">
          <DropdownPicker label={null} options={COLORS}
            value={color} onChange={readOnly ? ()=>{} : setColor}
            placeholder="Select color…" disabled={readOnly} />
        </Section>

        {/* Condition */}
        <Section title="Condition">
          <DropdownPicker label="Density (granular soils)"
            options={DENSITIES} value={density}
            onChange={readOnly ? ()=>{} : setDensity}
            placeholder="Select density…" disabled={readOnly} />
          <DropdownPicker label="Stiffness (cohesive soils)"
            options={STIFFNESSES} value={stiffness}
            onChange={readOnly ? ()=>{} : setStiffness}
            placeholder="Select stiffness…" disabled={readOnly} />
          <DropdownPicker label="Bedrock condition"
            options={BEDROCK_CONDS} value={bedrock}
            onChange={readOnly ? ()=>{} : setBedrock}
            placeholder="Select bedrock condition…" disabled={readOnly} />
        </Section>

        {/* Moisture */}
        <Section title="Moisture">
          <DropdownPicker label={null} options={MOISTURES}
            value={moisture} onChange={readOnly ? ()=>{} : setMoisture}
            placeholder="Select moisture…" disabled={readOnly} />
        </Section>

        {/* Additional Notes (appended to description) */}
        <Section title="Additional Notes">
          <TextInput style={[s.input, s.textarea]} multiline numberOfLines={3}
            placeholder="e.g. some wood debris, primarily medium to coarse grained sand"
            placeholderTextColor="#94A3B8"
            value={notes} onChangeText={setNotes} editable={!readOnly} />
        </Section>

        {/* ── Live Preview ── */}
        {!!pm && (
          <View style={s.previewCard}>
            <Text style={s.previewCardLabel}>TITLE</Text>
            <Text style={s.previewTitle}>{title || '—'}</Text>
            <View style={s.previewDivider} />
            <Text style={s.previewCardLabel}>DESCRIPTION</Text>
            <Text style={s.previewDesc}>{description || '—'}</Text>
          </View>
        )}

        {/* Remarks */}
        <Section title="Remarks (optional)">
          <TextInput style={[s.input, s.textarea]} multiline numberOfLines={2}
            placeholder="Internal field notes…" placeholderTextColor="#94A3B8"
            value={remarks} onChangeText={setRemarks} editable={!readOnly} />
        </Section>

        {!readOnly && (
          <TouchableOpacity style={s.bigSaveBtn} onPress={save}>
            <Text style={s.bigSaveTxt}>{isEdit ? 'Update Entry' : 'Add Entry'}</Text>
          </TouchableOpacity>
        )}

      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:         { flex:1, backgroundColor:C.navy },
  header:       { flexDirection:'row', alignItems:'center', padding:12,
                  backgroundColor:C.navy, gap:8 },
  back:         { paddingHorizontal:4 },
  backTxt:      { color:'#fff', fontSize:14 },
  headerTitle:  { flex:1, color:'#fff', fontSize:16, fontWeight:'bold' },
  saveBtn:      { backgroundColor:'#fff', paddingHorizontal:14, paddingVertical:7, borderRadius:8 },
  saveBtnTxt:   { color:C.navy, fontWeight:'bold', fontSize:13 },

  readOnlyBanner:    { backgroundColor:'#FEF9C3', borderRadius:8, padding:10, marginBottom:12 },
  readOnlyBannerTxt: { color:'#92400E', fontSize:13, textAlign:'center' },

  scroll:       { backgroundColor:C.bg },
  content:      { padding:14, paddingBottom:56 },
  section:      { marginBottom:18 },
  sectionTitle: { fontSize:11, fontWeight:'700', color:C.navy, marginBottom:10,
                  textTransform:'uppercase', letterSpacing:0.5 },
  row:          { flexDirection:'row', gap:8 },
  half:         { flex:1 },
  fieldLabel:   { fontSize:11, color:C.muted, fontWeight:'600', marginBottom:5, marginTop:8 },
  input:        { borderWidth:1.5, borderColor:C.border, borderRadius:8,
                  padding:10, fontSize:14, backgroundColor:C.white, color:C.text },
  textarea:     { minHeight:72, textAlignVertical:'top' },

  // Tier layout
  tierRow:      { flexDirection:'row', alignItems:'center', marginTop:14, marginBottom:6 },
  tierLabel:    { flex:1, fontSize:11, fontWeight:'800', color:C.blue,
                  letterSpacing:0.8, textTransform:'uppercase' },
  tierHint:     { fontWeight:'400', color:C.muted, fontSize:10 },
  tierBox:      { backgroundColor:'#F1F5F9', borderRadius:10, padding:12,
                  borderWidth:1, borderColor:C.accent, marginBottom:6 },

  toggleBtn:    { paddingVertical:6 },
  toggleTxt:    { color:C.blue, fontSize:12, fontWeight:'600' },
  geoBox:       { backgroundColor:C.lightBlue, borderRadius:10, padding:10,
                  borderWidth:1, borderColor:C.accent, marginBottom:6 },

  addBtn:       { backgroundColor:C.blue, paddingHorizontal:12, paddingVertical:4, borderRadius:12 },
  addTxt:       { color:'#fff', fontSize:12, fontWeight:'700' },
  removeBtn:    { paddingHorizontal:10, paddingVertical:4, borderRadius:12,
                  borderWidth:1, borderColor:'#FCA5A5', backgroundColor:'#FEF2F2' },
  removeTxt:    { color:C.red, fontSize:12, fontWeight:'600' },

  modTypeBtns:      { gap:6, marginBottom:6 },
  modTypeBtn:       { paddingVertical:10, paddingHorizontal:12, borderRadius:8,
                      borderWidth:1.5, borderColor:C.border, backgroundColor:C.white },
  modTypeBtnActive: { backgroundColor:C.navy, borderColor:C.navy },
  modTypeTxt:       { fontSize:12, color:C.muted },
  modTypeTxtActive: { color:'#fff', fontWeight:'700' },

  previewPill:  { backgroundColor:'#DCFCE7', borderRadius:8, paddingHorizontal:10,
                  paddingVertical:6, marginTop:6, alignSelf:'flex-start' },
  previewTxt:   { color:C.green, fontWeight:'700', fontSize:13 },

  // Live preview card
  previewCard:      { backgroundColor:C.navy, borderRadius:12, padding:14, marginBottom:18 },
  previewCardLabel: { fontSize:9, fontWeight:'800', color:'rgba(255,255,255,0.55)',
                      letterSpacing:1, textTransform:'uppercase', marginBottom:4 },
  previewTitle:     { fontSize:16, fontWeight:'900', color:'#fff', marginBottom:10 },
  previewDivider:   { height:1, backgroundColor:'rgba(255,255,255,0.15)', marginBottom:10 },
  previewDesc:      { fontSize:13, color:'rgba(255,255,255,0.88)', lineHeight:20 },

  bigSaveBtn:   { backgroundColor:C.navy, borderRadius:10, padding:16,
                  alignItems:'center', marginTop:8 },
  bigSaveTxt:   { color:'#fff', fontWeight:'bold', fontSize:15 },

  // Dropdown
  ddWrap:       { marginTop:2 },
  ddBtn:        { flexDirection:'row', alignItems:'center', borderWidth:1.5,
                  borderColor:C.border, borderRadius:8, paddingHorizontal:12,
                  paddingVertical:11, backgroundColor:C.white },
  ddDisabled:   { opacity:0.6 },
  ddBtnTxt:     { flex:1, fontSize:14, color:C.text },
  ddPlaceholder:{ color:'#94A3B8' },
  ddArrow:      { color:C.muted, fontSize:12, marginLeft:6 },

  // Bottom sheet
  sheetOverlay: { flex:1, backgroundColor:'rgba(0,0,0,0.45)', justifyContent:'flex-end' },
  sheet:        { backgroundColor:C.white, borderTopLeftRadius:18, borderTopRightRadius:18,
                  maxHeight:'72%', paddingBottom:24 },
  sheetHeader:  { flexDirection:'row', alignItems:'center', padding:16,
                  borderBottomWidth:1, borderColor:C.border },
  sheetTitle:   { flex:1, fontSize:15, fontWeight:'700', color:C.navy },
  sheetClose:   { fontSize:16, color:C.muted, paddingHorizontal:8 },

  clearRow:     { paddingVertical:13, paddingHorizontal:16, borderBottomWidth:1, borderColor:'#F1F5F9' },
  clearTxt:     { color:C.muted, fontSize:13, fontStyle:'italic', textAlign:'center' },
  optRow:       { flexDirection:'row', alignItems:'center', paddingVertical:13,
                  paddingHorizontal:16, borderBottomWidth:1, borderColor:'#F1F5F9' },
  optRowActive: { backgroundColor:C.lightBlue },
  optTxt:       { flex:1, fontSize:14, color:C.text },
  optTxtActive: { color:C.navy, fontWeight:'700' },
  optCheck:     { color:C.blue, fontWeight:'bold', fontSize:15, marginLeft:8 },

  othersView:   { padding:16 },
  othersHint:   { fontSize:13, color:C.muted, marginBottom:10 },
  othersInput:  { borderWidth:1.5, borderColor:C.border, borderRadius:8,
                  padding:12, fontSize:14, color:C.text, backgroundColor:C.white },
  othersBtns:   { flexDirection:'row', gap:10, marginTop:14 },
  othersBack:   { flex:1, paddingVertical:11, borderWidth:1.5, borderColor:C.border,
                  borderRadius:8, alignItems:'center' },
  othersBackTxt:{ color:C.muted, fontWeight:'600' },
  othersOk:     { flex:1, paddingVertical:11, backgroundColor:C.navy,
                  borderRadius:8, alignItems:'center' },
  othersOkTxt:  { color:'#fff', fontWeight:'bold' },
});
