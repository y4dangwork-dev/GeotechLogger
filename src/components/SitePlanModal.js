/**
 * SitePlanModal
 *
 * Interactive: Leaflet + Esri World Imagery satellite WebView
 * Export PDF: Geopacific-format A4 landscape site plan
 *   – Esri REST static map image
 *   – SVG overlay: borehole callouts, north arrow, scale bar, legend
 *   – Professional title block matching Geopacific drawing standard
 *
 * Props:
 *   visible    – bool
 *   job        – { projectName, jobNumber, clientName, locationName,
 *                  latitude, longitude, loggedBy }
 *   boreholes  – [{ id, boreholeNumber, latitude, longitude, groundElevation }]
 *   onClose    – () => void
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity,
  StyleSheet, Platform, ActivityIndicator, Alert,
} from 'react-native';

const C = {
  navy: '#1F3A5F', blue: '#2E75B6', white: '#fff',
  muted: '#64748B', red: '#DC2626', green: '#16A34A',
};

// ── Geometry helpers ──────────────────────────────────────────────────────────

function resolvePin(job, bh) {
  if (bh) {
    if (bh.latitude != null && bh.longitude != null)
      return { lat: Number(bh.latitude), lng: Number(bh.longitude) };
    return null;
  }
  if (job && job.latitude != null && job.longitude != null)
    return { lat: Number(job.latitude), lng: Number(job.longitude) };
  return null;
}

function buildPins(job, boreholes) {
  const pins = [];
  const jobPt = resolvePin(job);
  if (jobPt) pins.push({ id: '__job__', label: 'SITE', ...jobPt, isJob: true });
  (boreholes || []).forEach(bh => {
    const pt = resolvePin(null, bh);
    if (pt) pins.push({ id: bh.id, label: bh.boreholeNumber || bh.id, ...pt, isJob: false });
  });
  return pins;
}

function computeBbox(pins) {
  if (pins.length === 0) return null;
  let minLat = pins[0].lat, maxLat = pins[0].lat;
  let minLng = pins[0].lng, maxLng = pins[0].lng;
  pins.forEach(p => {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  });
  const latPad = Math.max(0.003, (maxLat - minLat) * 0.35);
  const lngPad = Math.max(0.003, (maxLng - minLng) * 0.35);
  return {
    west:  minLng - lngPad,
    south: minLat - latPad,
    east:  maxLng + lngPad,
    north: maxLat + latPad,
  };
}

function toPixel(lat, lng, bbox, W, H) {
  return {
    x: ((lng - bbox.west)  / (bbox.east  - bbox.west))  * W,
    y: ((bbox.north - lat) / (bbox.north - bbox.south)) * H,
  };
}

// Ground width in metres for the bbox
function groundWidthM(bbox) {
  const centerLat = (bbox.north + bbox.south) / 2;
  return (bbox.east - bbox.west) * Math.cos(centerLat * Math.PI / 180) * 111320;
}

// Nice round scale bar length (metres)
function niceScaleBar(metersPerPixel, maxPixels) {
  const steps = [1,2,5,10,20,50,100,200,500,1000,2000,5000,10000];
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i] / metersPerPixel <= maxPixels) return steps[i];
  }
  return steps[0];
}

// Approx 1:N scale ratio
function approxScale(bbox, mapWidthMm) {
  const gw = groundWidthM(bbox);           // metres
  const ratio = (gw * 1000) / mapWidthMm;  // mm on ground / mm on paper
  const nice = [100,200,250,500,750,1000,1250,1500,2000,2500,5000,10000,20000,50000];
  return nice.reduce((prev, cur) =>
    Math.abs(cur - ratio) < Math.abs(prev - ratio) ? cur : prev);
}

// Esri World Imagery static export
function esriUrl(bbox, W, H) {
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?` +
    `bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}` +
    `&bboxSR=4326&size=${W},${H}&imageSR=4326&format=png&transparent=false&f=image`;
}

// Format today's date as "MONTH DD, YYYY"
function todayStr() {
  const d = new Date();
  const months = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
                  'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// ── Leaflet WebView HTML (interactive) ───────────────────────────────────────

const SITE_PLAN_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=1056, initial-scale=1"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{margin:0;padding:0;width:100%;height:100%;touch-action:none;}</style>
</head>
<body>
<div id="map"></div>
<script>
var map = L.map('map',{zoomControl:true, tap:false, dragging:true}).setView([-25,133],4);
/* Google Earth satellite base */
L.tileLayer(
  'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
  {attribution:'&copy; Google',maxZoom:21}
).addTo(map);

var markers = {};
var jobMk = null;

function loadSitePlan(pins) {
  if (jobMk) { map.removeLayer(jobMk); jobMk = null; }
  Object.values(markers).forEach(function(m){map.removeLayer(m);});
  markers = {};
  var latlngs = [];
  var jobLatLng = null;
  pins.forEach(function(p) {
    latlngs.push([p.lat,p.lng]);
    var html, icon;
    if (p.isJob) {
      jobLatLng = [p.lat, p.lng];
      html = '<div style="background:#E85D04;width:13px;height:13px;border-radius:50%;border:2.5px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,0.8)"></div>';
      icon = L.divIcon({className:'',html:html,iconSize:[13,13],iconAnchor:[6,6]});
    } else {
      html = '<div style="display:flex;align-items:center;gap:4px;white-space:nowrap">' +
        '<svg width="13" height="13" viewBox="0 0 13 13" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0">' +
          '<circle cx="6.5" cy="6.5" r="5.8" fill="white" stroke="#000" stroke-width="1"/>' +
          '<path d="M6.5,6.5 L6.5,0.7 A5.8,5.8 0 0,1 12.3,6.5 Z" fill="#000"/>' +
          '<path d="M6.5,6.5 L6.5,12.3 A5.8,5.8 0 0,1 0.7,6.5 Z" fill="#000"/>' +
          '<line x1="0.7" y1="6.5" x2="12.3" y2="6.5" stroke="#000" stroke-width="0.7"/>' +
          '<line x1="6.5" y1="0.7" x2="6.5" y2="12.3" stroke="#000" stroke-width="0.7"/>' +
          '<circle cx="6.5" cy="6.5" r="5.8" fill="none" stroke="#000" stroke-width="1"/>' +
        '</svg>' +
        '<span style="font-family:Arial;font-size:9px;font-weight:bold;color:#fff;text-shadow:1px 1px 2px #000,-1px -1px 2px #000">' + p.label + '</span>' +
      '</div>';
      icon = L.divIcon({className:'',html:html,iconAnchor:[0,6]});
    }
    var m = L.marker([p.lat,p.lng],{icon:icon}).addTo(map);
    m.bindPopup('<b>'+p.label+'</b><br/>'+p.lat.toFixed(6)+', '+p.lng.toFixed(6));
    if (p.isJob) { jobMk = m; } else { markers[p.id] = m; }
  });
  // Auto-aim: fly to job GPS first, then fit all pins
  if (jobLatLng) {
    map.setView(jobLatLng, 17, {animate:false});
  }
  if (latlngs.length === 1) {
    map.flyTo(latlngs[0], 17, {animate:true, duration:1.0});
  } else if (latlngs.length > 1) {
    map.flyToBounds(latlngs, {padding:[50,50], animate:true, duration:1.2});
  }
}

/* ── Draw Area (crop box) + Text Annotation tools ── */
var drawMode = false, labelMode = false;
var cropRect = null, cropHandles = [], cropCenter = null;
var cropN, cropS, cropE, cropW;   // live crop edges — each corner owns its edges
var customBbox = null;
var annotations = [];  // [{lat,lng,text,_marker}]

/* ── Corner: small dot + large invisible touch area ── */
function cornerIcon() {
  return L.divIcon({
    className:'',
    html:'<div style="width:44px;height:44px;position:relative;cursor:crosshair">' +
           '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);' +
                       'width:10px;height:10px;border-radius:50%;' +
                       'background:#fff;border:2px solid #DC2626;' +
                       'box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>' +
         '</div>',
    iconSize:[44,44], iconAnchor:[22,22]
  });
}
function invisibleMoveIcon() {
  return L.divIcon({
    className:'',
    html:'<div style="width:60px;height:60px;background:transparent;cursor:move"></div>',
    iconSize:[60,60], iconAnchor:[30,30]
  });
}

function enforceMinSize() {
  var minGap = 0.0005;
  if (cropN - cropS < minGap) { var mLat=(cropN+cropS)/2; cropN=mLat+minGap/2; cropS=mLat-minGap/2; }
  if (cropE - cropW < minGap) { var mLng=(cropE+cropW)/2; cropE=mLng+minGap/2; cropW=mLng-minGap/2; }
}

function syncHandlesToEdges() {
  if (cropHandles.length < 4) return;
  cropHandles[0].setLatLng([cropN, cropW]);  // NW
  cropHandles[1].setLatLng([cropN, cropE]);  // NE
  cropHandles[2].setLatLng([cropS, cropE]);  // SE
  cropHandles[3].setLatLng([cropS, cropW]);  // SW
  cropRect.setBounds([[cropS,cropW],[cropN,cropE]]);
  customBbox = { north:cropN, south:cropS, east:cropE, west:cropW };
  if (cropCenter) cropCenter.setLatLng([(cropN+cropS)/2,(cropE+cropW)/2]);
  postMsg({type:'bboxUpdating', bbox:customBbox});
}

// PDF map-area: page(1056-3) × (816-3-0.55×96-0.9×96) = 1053×674
var CROP_RATIO = 1053 / 674;  // width ÷ height — must match buildPdfHtml layout

/* Snap cropE so the box has exactly CROP_RATIO screen-pixel aspect ratio,
   keeping cropN/cropS/cropW fixed. Called after every corner dragend. */
function snapAspectRatio() {
  var nwPt = map.latLngToContainerPoint([cropN, cropW]);
  var swPt = map.latLngToContainerPoint([cropS, cropW]);
  var hPx  = Math.abs(nwPt.y - swPt.y);
  var wPx  = hPx * CROP_RATIO;
  cropE = map.containerPointToLatLng(L.point(nwPt.x + wPx, nwPt.y)).lng;
  syncHandlesToEdges();
}

function showCropBox() {
  hideCropBox();
  // Initialise at correct aspect ratio using screen-pixel coordinates
  var mapSize = map.getSize();
  var cPt  = map.latLngToContainerPoint(map.getCenter());
  var hPx  = mapSize.y * 0.64;
  var wPx  = hPx * CROP_RATIO;
  var nwLL = map.containerPointToLatLng(L.point(cPt.x - wPx / 2, cPt.y - hPx / 2));
  var seLL = map.containerPointToLatLng(L.point(cPt.x + wPx / 2, cPt.y + hPx / 2));
  cropN = nwLL.lat; cropW = nwLL.lng;
  cropS = seLL.lat; cropE = seLL.lng;

  cropRect = L.rectangle([[cropS,cropW],[cropN,cropE]], {
    color:'#DC2626', weight:2.5, dashArray:'7 4',
    fillColor:'rgba(220,38,38,0.06)', fillOpacity:1, interactive:false
  }).addTo(map);
  customBbox = { north:cropN, south:cropS, east:cropE, west:cropW };

  // NW — controls north & west
  var hNW = L.marker([cropN,cropW], {icon:cornerIcon(), draggable:true, zIndexOffset:1000}).addTo(map);
  hNW.on('drag', function(){ var ll=hNW.getLatLng(); cropN=ll.lat; cropW=ll.lng; enforceMinSize(); syncHandlesToEdges(); });
  hNW.on('dragend', function(){ snapAspectRatio(); postMsg({type:'bboxSet', bbox:customBbox}); });
  cropHandles.push(hNW);

  // NE — controls north & east
  var hNE = L.marker([cropN,cropE], {icon:cornerIcon(), draggable:true, zIndexOffset:1000}).addTo(map);
  hNE.on('drag', function(){ var ll=hNE.getLatLng(); cropN=ll.lat; cropE=ll.lng; enforceMinSize(); syncHandlesToEdges(); });
  hNE.on('dragend', function(){ snapAspectRatio(); postMsg({type:'bboxSet', bbox:customBbox}); });
  cropHandles.push(hNE);

  // SE — controls south & east
  var hSE = L.marker([cropS,cropE], {icon:cornerIcon(), draggable:true, zIndexOffset:1000}).addTo(map);
  hSE.on('drag', function(){ var ll=hSE.getLatLng(); cropS=ll.lat; cropE=ll.lng; enforceMinSize(); syncHandlesToEdges(); });
  hSE.on('dragend', function(){ snapAspectRatio(); postMsg({type:'bboxSet', bbox:customBbox}); });
  cropHandles.push(hSE);

  // SW — controls south & west
  var hSW = L.marker([cropS,cropW], {icon:cornerIcon(), draggable:true, zIndexOffset:1000}).addTo(map);
  hSW.on('drag', function(){ var ll=hSW.getLatLng(); cropS=ll.lat; cropW=ll.lng; enforceMinSize(); syncHandlesToEdges(); });
  hSW.on('dragend', function(){ snapAspectRatio(); postMsg({type:'bboxSet', bbox:customBbox}); });
  cropHandles.push(hSW);

  // Center — move entire box
  var prevLl = null;
  cropCenter = L.marker([(cropN+cropS)/2,(cropE+cropW)/2], {
    icon:invisibleMoveIcon(), draggable:true, zIndexOffset:1002
  }).addTo(map);
  cropCenter.on('dragstart', function(){ prevLl=cropCenter.getLatLng(); });
  cropCenter.on('drag', function(){
    var cur=cropCenter.getLatLng();
    if (!prevLl){ prevLl=cur; return; }
    var dlat=cur.lat-prevLl.lat, dlng=cur.lng-prevLl.lng;
    cropN+=dlat; cropS+=dlat; cropE+=dlng; cropW+=dlng;
    syncHandlesToEdges();
    prevLl=cur;
  });
  cropCenter.on('dragend', function(){ prevLl=null; postMsg({type:'bboxSet',bbox:customBbox}); });

  postMsg({type:'bboxUpdating', bbox:customBbox});
}

function hideCropHandles() {
  cropHandles.forEach(function(h){ map.removeLayer(h); });
  cropHandles=[];
  if (cropCenter){ map.removeLayer(cropCenter); cropCenter=null; }
}

function hideCropBox() {
  if (cropRect){ map.removeLayer(cropRect); cropRect=null; }
  hideCropHandles();
}

/* ── Label helpers ── */
function labelIcon(text, rotation) {
  var rot = rotation || 0;
  return L.divIcon({
    className:'',
    html:'<div style="display:inline-block;background:rgba(255,255,255,0.95);border:1.5px solid #1F3A5F;border-radius:3px;padding:2px 8px;font-size:12px;font-family:Arial;font-weight:bold;color:#1F3A5F;white-space:nowrap;box-shadow:0 1px 5px rgba(0,0,0,0.35);cursor:move;transform:rotate('+rot+'deg);transform-origin:left center">' + escHtml(text) + '</div>',
    iconAnchor:[0,16]
  });
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function placeLabel(lat, lng, text, rotation) {
  if (!text || !text.trim()) return;
  text = text.trim();
  rotation = rotation || 0;
  var ann = {lat:lat, lng:lng, text:text, rotation:rotation};
  var marker = L.marker([lat,lng],{icon:labelIcon(text, rotation), draggable:true, zIndexOffset:500}).addTo(map);
  marker.on('dragend', function(){
    var ll = marker.getLatLng();
    ann.lat = ll.lat; ann.lng = ll.lng;
    postMsg({type:'exportState', customBbox:customBbox,
      annotations:annotations.map(function(a){return {lat:a.lat,lng:a.lng,text:a.text,rotation:a.rotation||0};})});
  });
  // Long-press to edit (600ms hold, cancelled if finger moves)
  (function(){
    var lpTimer = null;
    var el = marker.getElement ? marker.getElement() : null;
    function startHold(){ lpTimer = setTimeout(function(){ lpTimer=null; var idx=annotations.indexOf(ann); postMsg({type:'editLabel',idx:idx,text:ann.text,lat:ann.lat,lng:ann.lng,rotation:ann.rotation||0}); }, 600); }
    function cancelHold(){ if(lpTimer){ clearTimeout(lpTimer); lpTimer=null; } }
    marker.on('add', function(){ el=marker.getElement(); if(!el) return; el.addEventListener('touchstart',startHold,{passive:true}); el.addEventListener('touchend',cancelHold,{passive:true}); el.addEventListener('touchmove',cancelHold,{passive:true}); el.addEventListener('touchcancel',cancelHold,{passive:true}); });
    if(marker.getElement()){ el=marker.getElement(); el.addEventListener('touchstart',startHold,{passive:true}); el.addEventListener('touchend',cancelHold,{passive:true}); el.addEventListener('touchmove',cancelHold,{passive:true}); el.addEventListener('touchcancel',cancelHold,{passive:true}); }
  })();
  ann._marker = marker;
  annotations.push(ann);
  postMsg({type:'annotationAdded', count:annotations.length});
}

function updateLabel(idx, newText, rotation) {
  if (idx < 0 || idx >= annotations.length || !newText || !newText.trim()) return;
  newText = newText.trim();
  var ann = annotations[idx];
  ann.text = newText;
  ann.rotation = rotation || 0;
  ann._marker.setIcon(labelIcon(newText, ann.rotation));
  postMsg({type:'annotationAdded', count:annotations.length});
}

/* ── Core API ── */
function postMsg(obj) {
  var s = JSON.stringify(obj);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
  else window.postMessage(s,'*');
}

function setMode(mode) {
  drawMode = (mode === 'draw');
  labelMode = (mode === 'label');
  if (drawMode) {
    showCropBox();
    map.dragging.enable();
  } else {
    hideCropHandles();
    map.dragging.enable();
  }
  postMsg({type:'mode', mode:mode});
}

function resetCustomArea() {
  hideCropBox();
  customBbox = null;
  annotations.forEach(function(a){ if (a._marker) map.removeLayer(a._marker); });
  annotations = [];
  map.dragging.enable();
  drawMode = false; labelMode = false;
  postMsg({type:'reset'});
}

function getExportState() {
  postMsg({type:'exportState', customBbox:customBbox,
    annotations:annotations.map(function(a){return {lat:a.lat,lng:a.lng,text:a.text,rotation:a.rotation||0};})});
}

// Tap map in label mode → ask RN for text (no JS prompt)
map.on('click', function(e) {
  if (!labelMode) return;
  postMsg({type:'labelRequest', lat:e.latlng.lat, lng:e.latlng.lng});
});

</script>
</body>
</html>`;

const SITE_PLAN_SOURCE = { html: SITE_PLAN_HTML };

// ── PDF HTML builder (Geopacific format, Letter landscape) ──────────────────────

// Real Geopacific logo extracted from borehole template PDF
const LOGO_B64 = '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';

function buildPdfHtml(job, boreholes, pins, customBbox, annotations) {
  const bbox = customBbox || computeBbox(pins);
  if (!bbox) return null;

  // Letter landscape: 11 × 8.5 in = 279.4 × 215.9mm
  // Map image dimensions match aspect ratio of map area
  const W = 1156, H = 640;
  const mapUrl = esriUrl(bbox, W, H);

  // Scale calculations
  const mpp = groundWidthM(bbox) / W;
  const scaleM  = niceScaleBar(mpp, W * 0.18);
  const scalePx = (scaleM / mpp).toFixed(1);
  const scaleRatio = approxScale(bbox, 267); // 267mm ≈ map width on Letter landscape

  // ── SVG borehole callouts ────────────────────────────────────────────────
  const positioned = pins.map(p => ({ ...p, ...toPixel(p.lat, p.lng, bbox, W, H) }));
  const callouts = positioned.map((p) => {
    const { x, y, label, isJob } = p;
    if (isJob) return '';
    const nearRight = x > W * 0.8, nearTop = y < H * 0.2;
    const dx = nearRight ? -18 : 18, dy = nearTop ? 18 : -18;
    const tx = x + dx + (nearRight ? -(label.length * 5.5) : 0);
    const ty = y + dy + (nearTop ? 10 : -2);
    return `
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" fill="white" stroke="#000" stroke-width="1"/>
      <path d="M${x.toFixed(1)},${y.toFixed(1)} L${x.toFixed(1)},${(y-5.5).toFixed(1)} A5.5,5.5 0 0,1 ${(x+5.5).toFixed(1)},${y.toFixed(1)} Z" fill="#000"/>
      <path d="M${x.toFixed(1)},${y.toFixed(1)} L${x.toFixed(1)},${(y+5.5).toFixed(1)} A5.5,5.5 0 0,1 ${(x-5.5).toFixed(1)},${y.toFixed(1)} Z" fill="#000"/>
      <line x1="${(x-5.5).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x+5.5).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#000" stroke-width="0.7"/>
      <line x1="${x.toFixed(1)}" y1="${(y-5.5).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y+5.5).toFixed(1)}" stroke="#000" stroke-width="0.7"/>
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" fill="none" stroke="#000" stroke-width="1"/>
      <line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x+dx*0.7).toFixed(1)}" y2="${(y+dy*0.7).toFixed(1)}" stroke="white" stroke-width="0.8"/>
      <text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}"
        font-family="Arial" font-size="9" font-weight="bold"
        fill="white" stroke="black" stroke-width="2" paint-order="stroke">${label}</text>`;
  }).join('\n');

  // ── North arrow (top-left of map) ───────────────────────────────────────
  const northArrow = `
    <g transform="translate(36,44)">
      <polygon points="0,-16 -5,0 5,0" fill="white"/>
      <polygon points="0,16 -5,0 5,0" fill="rgba(255,255,255,0.3)" stroke="white" stroke-width="0.5"/>
      <line x1="-14" y1="0" x2="14" y2="0" stroke="white" stroke-width="0.7"/>
      <text x="0" y="-20" text-anchor="middle" font-family="Arial" font-size="9" font-weight="bold" fill="white">N</text>
    </g>`;

  // ── Scale bar (bottom-left of map) ──────────────────────────────────────
  const sbX = 14, sbY = H - 48;
  const scaleLabel = scaleM >= 1000 ? `${(scaleM/1000).toFixed(0)} km` : `${scaleM} m`;
  const scaleBar = `
    <g transform="translate(${sbX},${sbY})">
      <rect x="0" y="0" width="${scalePx}" height="6" fill="white" stroke="black" stroke-width="0.5"/>
      <rect x="0" y="0" width="${(scalePx/2).toFixed(1)}" height="6" fill="black"/>
      <line x1="0" y1="0" x2="0" y2="10" stroke="white" stroke-width="1"/>
      <line x1="${(scalePx/2).toFixed(1)}" y1="0" x2="${(scalePx/2).toFixed(1)}" y2="10" stroke="white" stroke-width="1"/>
      <line x1="${scalePx}" y1="0" x2="${scalePx}" y2="10" stroke="white" stroke-width="1"/>
      <text x="0" y="18" font-family="Arial" font-size="8" fill="white" stroke="black" stroke-width="1.5" paint-order="stroke">0</text>
      <text x="${(scalePx/2).toFixed(1)}" y="18" text-anchor="middle" font-family="Arial" font-size="8" fill="white" stroke="black" stroke-width="1.5" paint-order="stroke">${(scaleM/2).toFixed(0)}m</text>
      <text x="${scalePx}" y="18" text-anchor="end" font-family="Arial" font-size="8" fill="white" stroke="black" stroke-width="1.5" paint-order="stroke">${scaleLabel}</text>
    </g>`;

  // ── Drawing data ─────────────────────────────────────────────────────────
  const fileNo  = job.jobNumber || '';
  const dwgNo   = fileNo ? `${fileNo}-01` : '';
  const drawnBy = (job.loggedBy || '').toUpperCase();

  // ── Text annotations from editing tool ──
  const annList = Array.isArray(annotations) ? annotations : [];
  const annotationsSvg = annList.map(ann => {
    if (ann.lat == null || ann.lng == null || !ann.text) return '';
    const pt = toPixel(ann.lat, ann.lng, bbox, W, H);
    const px = pt.x.toFixed(1), py = pt.y.toFixed(1);
    const tw = ann.text.length * 6 + 10; // approx text width
    const rot = ann.rotation || 0;
    const rotAttr = rot !== 0 ? ` transform="rotate(${rot},${px},${(pt.y-19).toFixed(1)})"` : '';
    return `<g${rotAttr}>
      <line x1="${px}" y1="${py}" x2="${px}" y2="${(pt.y-14).toFixed(1)}" stroke="#1F3A5F" stroke-width="1"/>
      <rect x="${(pt.x+2).toFixed(1)}" y="${(pt.y-26).toFixed(1)}" width="${tw}" height="14"
            fill="rgba(255,255,255,0.9)" stroke="#1F3A5F" stroke-width="0.8" rx="1"/>
      <text x="${(pt.x+5).toFixed(1)}" y="${(pt.y-15).toFixed(1)}"
            font-family="Arial" font-size="10" fill="#1F3A5F" font-weight="bold">${ann.text}</text>
    </g>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Site Plan</title>
<style>
  @page { size: 1056px 816px landscape; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { width: 1056px; height: 816px; overflow: hidden; }
  body { width: 1056px; height: 816px; overflow: hidden; font-family: Arial, sans-serif; background: #fff;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .page-wrap {
    width: 1056px; height: 816px;
    border: 1.5px solid #000;
    display: flex; flex-direction: column;
    box-sizing: border-box;
  }

  /* ── Map area ── */
  .map-area {
    flex: 1;
    position: relative;
    overflow: hidden;
  }
  .map-area img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .map-area svg.overlay {
    position: absolute; top: 0; left: 0;
    width: 100%; height: 100%;
    pointer-events: none;
  }

  /* ── Info strip ── */
  .info-strip {
    height: 0.55in;
    display: flex; flex-direction: row;
    border-top: 1.5px solid #000;
    border-bottom: 1.5px solid #000;
    flex-shrink: 0;
  }
  .is-legend {
    width: 3.2in;
    border-right: 1px solid #000;
    padding: 0.05in 0.12in;
    display: flex; flex-direction: column; justify-content: center; gap: 0.04in;
  }
  .is-legend-title { font-size: 8pt; font-weight: bold; text-decoration: underline; margin-bottom: 0.02in; }
  .is-legend-item  { font-size: 7pt; display: flex; align-items: center; gap: 0.06in; }
  .is-center {
    flex: 1;
    border-right: 1px solid #000;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 0.04in;
  }
  .is-main-title { font-size: 12pt; font-weight: bold; text-decoration: underline; letter-spacing: 1px; }
  .is-scale       { font-size: 8pt; margin-top: 0.03in; }
  .is-ref {
    width: 1.6in;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 0.05in;
    text-align: center; font-size: 7.5pt;
  }
  .is-ref .ref-label { font-size: 6.5pt; color: #555; }
  .is-ref .ref-val   { font-size: 8pt; font-weight: bold; margin-top: 0.02in; }

  /* ── Title block ── */
  .title-block {
    height: 0.9in;
    display: flex; flex-direction: row;
    flex-shrink: 0;
  }

  /* Logo cell */
  .tb-logo {
    width: 2.7in;
    display: flex; align-items: center; justify-content: center;
    padding: 0.05in 0.1in;
    border-right: 1px solid #000;
    overflow: hidden;
  }
  .tb-logo img { max-height: 0.78in; max-width: 2.55in; width: auto; height: auto; object-fit: contain; }

  /* Meta fields cell */
  .tb-meta {
    width: 1.4in;
    border-right: 1px solid #000;
    display: flex; flex-direction: column;
    font-size: 7pt;
  }
  .mrow {
    display: flex; flex-direction: row;
    border-bottom: 1px solid #ccc;
    flex: 1; align-items: center;
  }
  .mrow:last-child { border-bottom: none; }
  .mlabel {
    width: 0.85in; padding: 0 0.06in;
    font-weight: bold; color: #444;
    border-right: 1px solid #e0e0e0;
    white-space: nowrap; font-size: 6.5pt;
  }
  .mval { flex: 1; padding: 0 0.06in; font-style: italic; color: #111; }
  .mrow-sub {
    display: flex; flex-direction: row;
    border-bottom: 1px solid #ccc; flex: 1;
  }
  .msub {
    flex: 1; display: flex; flex-direction: column;
    border-right: 1px solid #e0e0e0; padding: 0.04in 0.05in;
    font-size: 5.5pt;
  }
  .msub:last-child { border-right: none; }
  .sl { color: #888; font-weight: bold; }
  .sv { font-style: italic; font-size: 6.5pt; }

  /* Title cell */
  .tb-title {
    flex: 1;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 0.06in 0.12in;
    border-right: 1px solid #000;
    text-align: center;
  }
  .t1 { font-size: 13pt; font-weight: bold; font-style: italic; letter-spacing: 1px; line-height: 1.1; }
  .t2 { font-size: 7.5pt; font-style: italic; color: #333; margin-top: 0.04in; }
  .t3 { font-size: 9pt; font-weight: bold; font-style: italic; margin-top: 0.04in; }

  /* Ref cell */
  .tb-ref {
    width: 1.1in;
    border-right: 1px solid #000;
    display: flex; flex-direction: column; font-size: 7pt;
  }
  .rrow {
    display: flex; flex-direction: column;
    border-bottom: 1px solid #ccc; padding: 0.05in 0.07in; flex: 1;
  }
  .rrow:last-child { border-bottom: none; }
  .rlabel { font-weight: bold; color: #555; font-size: 6pt; }
  .rval   { font-size: 11pt; font-weight: bold; color: #000; margin-top: 0.03in; }

  /* Revisions cell */
  .tb-rev {
    width: 0.65in;
    display: flex; flex-direction: column; font-size: 6.5pt;
    padding: 0.05in 0.06in;
  }
  .revtitle { font-weight: bold; color: #444; margin-bottom: 0.05in; }
  .revrow   { color: #666; margin-bottom: 0.04in; border-bottom: 1px solid #eee; padding-bottom: 0.04in; }

  /* Legend uses inline SVG quartered circle */
</style>
</head>
<body>
<div class="page-wrap">

  <!-- MAP AREA -->
  <div class="map-area">
    <img src="${mapUrl}" alt="Satellite"/>
    <svg class="overlay" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      ${callouts}
      ${annotationsSvg}
      ${northArrow}
      ${scaleBar}
    </svg>
  </div>

  <!-- INFO STRIP -->
  <div class="info-strip">
    <div class="is-legend">
      <div class="is-legend-title">LEGEND:</div>
      <div class="is-legend-item"><svg width="13" height="13" viewBox="0 0 13 13" xmlns="http://www.w3.org/2000/svg" style="vertical-align:middle;flex-shrink:0;display:inline-block;margin-right:4px;">
        <circle cx="6.5" cy="6.5" r="5.8" fill="white" stroke="#000" stroke-width="1"/>
        <path d="M6.5,6.5 L6.5,0.7 A5.8,5.8 0 0,1 12.3,6.5 Z" fill="#000"/>
        <path d="M6.5,6.5 L6.5,12.3 A5.8,5.8 0 0,1 0.7,6.5 Z" fill="#000"/>
        <line x1="0.7" y1="6.5" x2="12.3" y2="6.5" stroke="#000" stroke-width="0.7"/>
        <line x1="6.5" y1="0.7" x2="6.5" y2="12.3" stroke="#000" stroke-width="0.7"/>
        <circle cx="6.5" cy="6.5" r="5.8" fill="none" stroke="#000" stroke-width="1"/>
      </svg>BHXX-XX / THXX-XX &nbsp;– PROPOSED TEST LOCATION</div>
    </div>
    <div class="is-center">
      <div class="is-main-title">PRELIMINARY SITE PLAN</div>
      <div class="is-scale">1:${scaleRatio.toLocaleString()}</div>
    </div>
    <div class="is-ref">
      <div class="ref-label">REFERENCE:</div>
      <div class="ref-val">GOOGLE EARTH</div>
    </div>
  </div>

  <!-- TITLE BLOCK -->
  <div class="title-block">

    <div class="tb-logo">
      <img src="data:image/png;base64,${LOGO_B64}" alt="Geopacific"/>
    </div>

    <div class="tb-meta">
      <div class="mrow">
        <div class="mlabel">DATE:</div>
        <div class="mval">${todayStr()}</div>
      </div>
      <div class="mrow-sub">
        <div class="msub"><div class="sl">DRAWN BY:</div><div class="sv">${drawnBy}</div></div>
        <div class="msub"><div class="sl">APPROVED BY:</div><div class="sv"></div></div>
        <div class="msub"><div class="sl">REVIEWED BY:</div><div class="sv"></div></div>
      </div>
      <div class="mrow">
        <div class="mlabel">SCALE:</div>
        <div class="mval">1:${scaleRatio.toLocaleString()}</div>
      </div>
    </div>

    <div class="tb-title">
      <div class="t1">${(job.projectName || 'PROPOSED DEVELOPMENT').toUpperCase()}</div>
      <div class="t2">${[job.locationName, job.clientName].filter(Boolean).join('  |  ').toUpperCase()}</div>
      <div class="t3">SITE PLAN</div>
    </div>

    <div class="tb-ref">
      <div class="rrow">
        <div class="rlabel">FILE NO.:</div>
        <div class="rval">${fileNo}</div>
      </div>
      <div class="rrow">
        <div class="rlabel">DWG. NO.:</div>
        <div class="rval">${dwgNo}</div>
      </div>
    </div>

    <div class="tb-rev">
      <div class="revtitle">REVISIONS:</div>
      <div class="revrow">A.</div>
      <div class="revrow">B.</div>
      <div class="revrow">C.</div>
    </div>

  </div>
</div>
</body>
</html>`;
}

// ── Named exports for external PDF generation ─────────────────────────────────
export { buildPdfHtml, buildPins, SITE_PLAN_SOURCE };

// ── Main component ────────────────────────────────────────────────────────────

export default function SitePlanModal({ visible, job, boreholes, onClose }) {
  const [mapReady,  setMapReady]  = useState(false);
  const [exporting, setExporting] = useState(false);
  const webViewRef = useRef(null);

  const pins    = job ? buildPins(job, boreholes || []) : [];
  const hasGPS  = pins.length > 0;

  function inject(js) { webViewRef.current?.injectJavaScript(js + '; true;'); }

  useEffect(() => {
    if (!mapReady || !visible) return;
    inject(`loadSitePlan(${JSON.stringify(pins)})`);
  }, [pins.length, mapReady, visible]);

  useEffect(() => {
    if (!visible) setMapReady(false);
  }, [visible]);

  function onMapLoad() { setTimeout(() => setMapReady(true), 700); }

  async function exportPDF() {
    if (!hasGPS) {
      Alert.alert('No GPS data', 'Add GPS coordinates to the job or boreholes first.');
      return;
    }
    setExporting(true);
    try {
      const Print   = require('expo-print');
      const Sharing = require('expo-sharing');

      const html = buildPdfHtml(job, boreholes || [], pins);
      if (!html) { Alert.alert('Error', 'Could not build PDF.'); return; }

      const pW = Platform.OS === 'ios' ? 1056 : 792;
      const pH = Platform.OS === 'ios' ? 816  : 612;
      const { uri } = await Print.printToFileAsync({ html, base64: false, width: pW, height: pH });
      if (await Sharing.isAvailableAsync()) {
        const fname = `SitePlan_${job.jobNumber || 'export'}.pdf`;
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: fname });
      } else {
        Alert.alert('Saved', `PDF saved to:\n${uri}`);
      }
    } catch (err) {
      Alert.alert('Export failed', String(err));
    } finally {
      setExporting(false);
    }
  }

  const { WebView } = require('react-native-webview');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.container}>

        <View style={s.header}>
          <TouchableOpacity onPress={onClose} style={s.closeBtn}
            hitSlop={{ top:10, bottom:10, left:10, right:10 }}>
            <Text style={s.closeTxt}>✕</Text>
          </TouchableOpacity>
          <View style={s.headerMid}>
            <Text style={s.title}>🗺 Site Plan</Text>
            {job && (
              <Text style={s.subtitle} numberOfLines={1}>
                {job.jobNumber ? job.jobNumber + '  · ' : ''}{job.projectName}
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={[s.exportBtn, exporting && s.exportBtnDisabled]}
            onPress={exportPDF}
            disabled={exporting}
          >
            {exporting
              ? <ActivityIndicator size="small" color={C.white} />
              : <Text style={s.exportTxt}>PDF ↓</Text>}
          </TouchableOpacity>
        </View>

        {hasGPS ? (
          <WebView
            ref={webViewRef}
            source={SITE_PLAN_SOURCE}
            style={{ flex: 1 }}
            onLoad={onMapLoad}
            javaScriptEnabled
            originWhitelist={['*']}
          />
        ) : (
          <View style={s.noGps}>
            <Text style={s.noGpsIcon}>📍</Text>
            <Text style={s.noGpsTxt}>No GPS data for this job</Text>
            <Text style={s.noGpsSub}>
              Add latitude/longitude to the job or any borehole to generate a site plan.
            </Text>
          </View>
        )}

        {hasGPS && (
          <View style={s.legendBar}>
            <View style={s.legendItem}>
              <View style={[s.dot, { backgroundColor: '#E85D04' }]} />
              <Text style={s.legendTxt}>Site</Text>
            </View>
            <View style={s.legendItem}>
              <View style={[s.dot, { borderWidth:1.5, borderColor:C.navy, backgroundColor:'#fff' }]} />
              <Text style={s.legendTxt}>Borehole</Text>
            </View>
            <Text style={s.legendSource}>© Google Earth</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.navy,
    paddingHorizontal: 14, paddingVertical: 12,
    paddingTop: Platform.OS === 'ios' ? 54 : 12,
    gap: 10,
  },
  closeBtn:  { padding: 4 },
  closeTxt:  { color: '#fff', fontSize: 18 },
  headerMid: { flex: 1 },
  title:     { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  subtitle:  { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 1 },
  exportBtn: {
    backgroundColor: C.green, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius:  6,
  },
  exportBtnDisabled: { opacity: 0.6 },
  exportTxt: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  noGps: {
    flex: 1, backgroundColor: '#F8FAFC',
    alignItems: 'center', justifyContent: 'center', padding: 32,
  },
  noGpsIcon: { fontSize: 48, marginBottom: 12 },
  noGpsTxt:  { fontSize: 16, fontWeight: '600', color: C.navy, textAlign: 'center', marginBottom: 8 },
  noGpsSub:  { fontSize: 13, color: C.muted, textAlign: 'center', lineHeight: 20 },
  legendBar: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    backgroundColor: C.navy, paddingHorizontal: 14, paddingVertical: 7,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot:        { width: 10, height: 10, borderRadius: 5 },
  legendTxt:   { color: '#fff', fontSize: 12 },
});
