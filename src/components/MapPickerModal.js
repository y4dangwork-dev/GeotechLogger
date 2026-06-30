import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Platform, ActivityIndicator,
} from 'react-native';

const C = {
  navy: '#1F3A5F', blue: '#2E75B6', white: '#fff',
  muted: '#64748B', red: '#DC2626',
};

const DEFAULT_LAT = -33.8688;
const DEFAULT_LNG = 151.2093;

// Static HTML — module-level constant prevents WebView reload on re-render
const MAP_PICKER_HTML = `<!DOCTYPE html>
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
var map = L.map('map').setView([-33.8688, 151.2093], 13);
L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
  {attribution:'&copy; Google',maxZoom:21}).addTo(map);

var marker = L.marker([-33.8688, 151.2093], {draggable:true}).addTo(map);

function send(lat, lng) {
  var msg = JSON.stringify({lat:lat, lng:lng});
  if (window.ReactNativeWebView) { window.ReactNativeWebView.postMessage(msg); }
  else { window.postMessage(msg, '*'); }
}

marker.on('dragend', function() {
  var ll = marker.getLatLng();
  send(ll.lat, ll.lng);
});

map.on('click', function(e) {
  marker.setLatLng(e.latlng);
  send(e.latlng.lat, e.latlng.lng);
});

function setCenter(lat, lng) {
  marker.setLatLng([lat, lng]);
  map.setView([lat, lng], 14);
  send(lat, lng);
}
</script>
</body>
</html>`;

const MAP_PICKER_SOURCE = { html: MAP_PICKER_HTML };

// ── MapPickerView (embeddable — used inside form modal) ───────────────────────
export function MapPickerView({ initialLat, initialLng, onConfirm, onCancel }) {
  const startLat = (initialLat != null && !isNaN(Number(initialLat))) ? Number(initialLat) : null;
  const startLng = (initialLng != null && !isNaN(Number(initialLng))) ? Number(initialLng) : null;

  const [coord,    setCoord]    = useState({ lat: startLat ?? DEFAULT_LAT, lng: startLng ?? DEFAULT_LNG });
  const [locating, setLocating] = useState(false);
  const [locErr,   setLocErr]   = useState('');
  const [mapReady, setMapReady] = useState(false);
  const webViewRef = useRef(null);

  function inject(js) { webViewRef.current?.injectJavaScript(js + '; true;'); }

  // After map loads: fly to initial coords, or auto-locate
  useEffect(() => {
    if (!mapReady) return;
    if (startLat != null && startLng != null) {
      inject(`setCenter(${startLat}, ${startLng})`);
    } else {
      goToMyLocation();
    }
  }, [mapReady]);

  async function goToMyLocation() {
    setLocating(true);
    setLocErr('');
    try {
      let Location;
      try { Location = require('expo-location'); }
      catch { setLocErr('Run: npx expo install expo-location'); return; }
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocErr('Location permission denied — tap the map to set a pin manually');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = pos.coords;
      setCoord({ lat: latitude, lng: longitude });
      inject(`setCenter(${latitude}, ${longitude})`);
    } catch {
      setLocErr('Unable to get GPS — tap the map to set a pin manually');
    } finally {
      setLocating(false);
    }
  }

  function onMapLoad() {
    setTimeout(() => setMapReady(true), 600);
  }

  function handleMessage(e) {
    try {
      const data = JSON.parse(e.nativeEvent?.data || e.data || '');
      if (data.lat != null && data.lng != null) {
        setCoord({ lat: data.lat, lng: data.lng });
      }
    } catch {}
  }

  const { WebView } = require('react-native-webview');

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={onCancel} style={s.cancelBtn}
          hitSlop={{ top:10, bottom:10, left:10, right:10 }}>
          <Text style={s.cancelTxt}>Cancel</Text>
        </TouchableOpacity>
        <Text style={s.title}>Select Location</Text>
        <TouchableOpacity
          onPress={() => onConfirm({ lat: coord.lat, lng: coord.lng })}
          style={s.confirmBtn}
          hitSlop={{ top:10, bottom:10, left:10, right:10 }}>
          <Text style={s.confirmTxt}>✓ Confirm</Text>
        </TouchableOpacity>
      </View>

      {/* Map */}
      <View style={{ flex: 1 }}>
        <WebView
          ref={webViewRef}
          source={MAP_PICKER_SOURCE}
          style={{ flex: 1 }}
          onLoad={onMapLoad}
          javaScriptEnabled
          originWhitelist={['*']}
          onMessage={handleMessage}
        />
        {/* My Location FAB */}
        <TouchableOpacity
          style={[s.locFab, locating && s.locFabActive]}
          onPress={goToMyLocation}
          disabled={locating}
        >
          {locating
            ? <ActivityIndicator size="small" color={C.blue} />
            : <Text style={s.locFabTxt}>📍</Text>}
        </TouchableOpacity>
      </View>

      {locErr ? <Text style={s.errTxt}>{locErr}</Text> : null}

      {/* Coord bar */}
      <View style={s.coordBar}>
        <Text style={s.coordTxt}>
          {coord.lat.toFixed(6)},  {coord.lng.toFixed(6)}
        </Text>
      </View>
    </View>
  );
}

// ── Default export (standalone overlay) ──────────────────────────────────────
export default function MapPickerModal({ visible, initialLat, initialLng, onConfirm, onCancel }) {
  if (!visible) return null;
  return (
    <View style={StyleSheet.absoluteFillObject}>
      <MapPickerView
        initialLat={initialLat}
        initialLng={initialLng}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.white },

  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.navy, paddingHorizontal: 16, paddingVertical: 14,
    paddingTop: Platform.OS === 'ios' ? 56 : 14,
  },
  cancelBtn:  { minWidth: 60 },
  cancelTxt:  { color: 'rgba(255,255,255,0.85)', fontSize: 15 },
  title:      { flex: 1, color: '#fff', fontSize: 16, fontWeight: 'bold', textAlign: 'center' },
  confirmBtn: {
    backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 8, minWidth: 60, alignItems: 'center',
  },
  confirmTxt: { color: C.navy, fontWeight: 'bold', fontSize: 14 },

  locFab: {
    position: 'absolute', bottom: 16, right: 16,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: C.white, alignItems: 'center', justifyContent: 'center',
    elevation: 4, shadowColor: '#000', shadowOpacity: 0.25,
    shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  locFabActive: { backgroundColor: '#EFF6FF' },
  locFabTxt:    { fontSize: 22 },

  coordBar: { backgroundColor: C.navy, paddingVertical: 10, alignItems: 'center' },
  coordTxt: { color: '#fff', fontSize: 13, fontWeight: '600', letterSpacing: 0.3 },

  errTxt: {
    backgroundColor: '#FEF2F2', color: C.red,
    fontSize: 12, textAlign: 'center', paddingVertical: 6,
  },
});
