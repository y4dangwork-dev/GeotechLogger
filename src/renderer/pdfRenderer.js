/**
 * GeoTechLogger PDF Renderer — JavaScript port of fill_template_renderer.py
 * Uses pdf-lib to generate borehole log PDFs on-device (no server needed).
 */
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import * as K from './constants';

// ─── State (per render, reset each call) ────────────────────────────────────
let _page         = null;
let _fonts        = {};
let _pageStart    = 0;   // depth (m) at top of current page
let _ptPerM       = K.PT_PER_M;
let _ptPerFt      = K.PT_PER_FT;

// ─── Coordinate helpers ──────────────────────────────────────────────────────
function dy(d) {
  return K.CONTENT_TOP - (d - _pageStart) * _ptPerM;
}

// ─── Low-level drawing helpers ───────────────────────────────────────────────
function hLine(x0, x1, y, lw = 0.5, col = K.C_BLACK) {
  _page.drawLine({ start:{x:x0,y}, end:{x:x1,y}, thickness:lw, color:rgb(...col) });
}
function vLine(x, y0, y1, lw = 0.5, col = K.C_BLACK) {
  _page.drawLine({ start:{x,y:y0}, end:{x,y:y1}, thickness:lw, color:rgb(...col) });
}
function box(x, y, w, h, fillCol = null, strokeCol = K.C_BLACK, lw = 0.5) {
  _page.drawRectangle({
    x, y, width: w, height: h,
    borderWidth: lw,
    color:       fillCol ? rgb(...fillCol) : undefined,
    borderColor: strokeCol ? rgb(...strokeCol) : undefined,
    opacity: 1,
  });
}

// Text drawing — font variants
function txt(x, y, s, opts = {}) {
  const { sz = 7, bold = false, italic = false, col = K.C_BLACK, align = 'left' } = opts;
  let font;
  if (bold && italic) font = _fonts.bi;
  else if (bold)      font = _fonts.b;
  else if (italic)    font = _fonts.i;
  else                font = _fonts.n;
  const str  = String(s);
  let drawX  = x;
  if (align === 'center') drawX = x - font.widthOfTextAtSize(str, sz) / 2;
  if (align === 'right')  drawX = x - font.widthOfTextAtSize(str, sz);
  _page.drawText(str, { x: drawX, y, size: sz, font, color: rgb(...col) });
}

function sw(s, sz, bold = false, italic = false) {
  let font;
  if (bold && italic) font = _fonts.bi;
  else if (bold)      font = _fonts.b;
  else if (italic)    font = _fonts.i;
  else                font = _fonts.n;
  return font.widthOfTextAtSize(String(s), sz);
}

// ─── Soil pattern drawing ─────────────────────────────────────────────────────
// pdf-lib doesn't have a clip API at high level, so we restrict by only
// drawing within bounds using manual range checks.
function drawPattern(soilType, x1, y1, x2, y2) {
  const w = x2 - x1, h = y2 - y1;
  if (w <= 0 || h <= 0) return;
  const st = (soilType || '').toUpperCase();
  const ln = (ax, ay, bx, by, lw = 0.5) =>
    _page.drawLine({ start:{x:ax,y:ay}, end:{x:bx,y:by}, thickness:lw, color:rgb(...K.C_BLACK) });

  if (st === 'TOPSOIL') {
    // USCS: horizontal lines + upward V grass marks
    for (let y = y1 + 3; y < y2; y += 7) {
      ln(x1, y, x2, y);
      if (y + 3 < y2)
        for (let x = x1 + 4; x < x2 - 1; x += 8) {
          ln(x, y, x - 2, Math.min(y + 3.5, y2));
          ln(x, y, x + 2, Math.min(y + 3.5, y2));
        }
    }

  } else if (st === 'FILL') {
    // Scattered irregular dots (fixed offset pattern per 10pt cell)
    const offsets = [[2,2,1.2],[7,6,1.2],[1,8,0.8],[9,1,0.8]];
    const cell = 10;
    for (let iy = Math.ceil(y1); iy < y2 + cell; iy += cell)
      for (let ix = Math.ceil(x1); ix < x2 + cell; ix += cell)
        for (const [ox,oy,r] of offsets) {
          const px = ix+ox, py = iy+oy;
          if (px >= x1 && px <= x2 && py >= y1 && py <= y2)
            _page.drawEllipse({ x:px, y:py, xScale:r, yScale:r, color:rgb(...K.C_BLACK) });
        }

  } else if (st === 'CLAY') {
    // USCS CL/CH: solid horizontal lines
    for (let y = y1 + 2; y < y2; y += 4) ln(x1, y, x2, y);

  } else if (st === 'SILT') {
    // USCS ML/MH: short horizontal dashes
    for (let y = y1 + 3; y < y2; y += 5)
      for (let x = x1 + 2; x < x2; x += 10)
        ln(x, y, Math.min(x + 5, x2), y);

  } else if (st === 'SAND') {
    // USCS SP/SW: scattered fine dots
    for (let iy = Math.ceil(y1) + 2; iy < y2; iy += 4)
      for (let ix = Math.ceil(x1) + 2; ix < x2; ix += 4)
        _page.drawEllipse({ x:ix, y:iy, xScale:0.6, yScale:0.6, color:rgb(...K.C_BLACK) });

  } else if (st === 'GRAVEL') {
    // USCS GP/GW: open ovals
    for (let iy = Math.ceil(y1) + 4; iy < y2; iy += 8)
      for (let ix = Math.ceil(x1) + 5; ix < x2; ix += 10)
        _page.drawEllipse({ x:ix, y:iy, xScale:3, yScale:2, borderColor:rgb(...K.C_BLACK), borderWidth:0.5 });

  } else if (st === 'COBBLES') {
    // Larger ovals
    for (let iy = Math.ceil(y1) + 6; iy < y2; iy += 12)
      for (let ix = Math.ceil(x1) + 7; ix < x2; ix += 14)
        _page.drawEllipse({ x:ix, y:iy, xScale:5, yScale:3, borderColor:rgb(...K.C_BLACK), borderWidth:0.5 });

  } else if (st === 'PEAT') {
    // USCS Pt: horizontal lines + zigzag organic marks between rows
    for (let y = y1 + 3; y < y2; y += 7) {
      ln(x1, y, x2, y);
      if (y + 2 < y2)
        for (let x = x1 + 2.5; x + 4 < x2; x += 8) {
          ln(x, Math.min(y + 1, y2), x + 2, Math.min(y + 3.5, y2));
          ln(x + 2, Math.min(y + 3.5, y2), x + 4, Math.min(y + 1, y2));
        }
    }

  } else if (st === 'ORGANIC') {
    // USCS OL/OH: diagonal lines + scattered dots
    const step = 6;
    for (let x = x1 - h; x < x2; x += step)
      ln(Math.max(x, x1), y1, Math.min(x + h, x2), y2, 0.4);
    for (let iy = Math.ceil(y1) + 3; iy < y2; iy += 8)
      for (let ix = Math.ceil(x1) + 3; ix < x2; ix += 10)
        _page.drawEllipse({ x:ix, y:iy, xScale:0.8, yScale:0.8, color:rgb(...K.C_BLACK) });

  } else if (st === 'BEDROCK' || st === 'ROCK') {
    // USCS: brick pattern — horizontal lines + alternating vertical joints
    const bh = 6, bw = 12;
    let row = 0, y = y1 + bh;
    while (y <= y2 + 0.5) {
      const yc = Math.min(y, y2);
      ln(x1, yc, x2, yc);
      const off = row % 2 === 1 ? bw / 2 : 0;
      for (let x = x1 + off; x <= x2; x += bw)
        ln(x, Math.max(y - bh, y1), x, yc);
      y += bh; row++;
    }

  } else {
    // default: diagonal
    const step = 6;
    for (let x = x1 - h; x < x2; x += step)
      ln(Math.max(x, x1), y1, Math.min(x + h, x2), y2, 0.4);
  }
}

// ─── Main drawing sections ───────────────────────────────────────────────────

function drawWhiteout() {
  box(K.X.left, K.DATA_BOT, K.X.right - K.X.left, K.GSUR_Y - K.DATA_BOT, K.C_WHITE, K.C_WHITE);
}

function drawDataStructure() {
  const lh = 1.45, ls = 0.70;
  hLine(K.X.dm,   K.X.elev,  K.GSUR_Y, lh);
  hLine(K.X.left, K.X.right, K.DATA_BOT, lh);
  vLine(K.X.left,  K.DATA_BOT, K.GSUR_Y, lh);
  vLine(K.X.right, K.DATA_BOT, K.GSUR_Y, lh);
  for (const xv of [K.X.dft,K.X.dm,K.X.sym,K.X.sdesc,K.X.elev,K.X.moist,K.X.dcpt,K.X.gw]) {
    const w = (xv===K.X.elev||xv===K.X.gw) ? lh : ls;
    vLine(xv, K.DATA_BOT, K.GSUR_Y, w);
  }

  // ft tick marks
  const pageStartFt = _pageStart * 3.28084;
  let ft = Math.floor(pageStartFt);
  while (true) {
    const y = K.CONTENT_TOP - (ft - pageStartFt) * _ptPerFt;
    if (y < K.DATA_BOT - 0.5) break;
    if (y <= K.CONTENT_TOP) {
      hLine(51.80, K.X.dft, y, 0.70);
      if (Math.abs(Math.round(ft) - ft) < 0.01 && y - 5 > K.DATA_BOT)
        txt((K.X.left + K.X.dft) / 2, y - 5, `${Math.round(ft)}`,
            { sz:7, col:K.C_CBLUE, align:'center' });
      for (let sub = 1; sub <= 4; sub++) {
        const ys = y - sub * _ptPerFt * 0.2;
        if (ys < K.DATA_BOT - 0.5) break;
        hLine(53.95, K.X.dft, ys, 0.50);
      }
    }
    ft += 1;
  }

  // m tick marks
  let m = Math.floor(_pageStart);
  while (true) {
    const y = dy(m);
    if (y < K.DATA_BOT - 0.5) break;
    if (y <= K.CONTENT_TOP) {
      hLine(K.X.dft, 63.30, y, 0.70);
      if (y - 7 > K.DATA_BOT)
        txt((K.X.dft + K.X.dm) / 2, y - 7, `${m}`,
            { sz:7, col:K.C_CBLUE, align:'center' });
      if (dy(m + 1) >= K.DATA_BOT - 0.5) {
        for (let sub = 1; sub <= 4; sub++) {
          const ys = dy(m + sub * 0.2);
          if (ys < K.DATA_BOT - 0.5) break;
          hLine(K.X.dft, 61.15, ys, 0.50);
        }
      }
    }
    m += 1;
  }

  // DCPT gray grid
  const dcptW = K.X.dcpt - K.DCPT_X0;
  const ppb   = dcptW / K.DCPT_SCALE_MAX;
  for (let v = 0; v <= K.DCPT_SCALE_MAX; v += 2) {
    const gx = K.DCPT_X0 + v * ppb;
    if (gx >= K.X.moist && gx <= K.X.dcpt)
      vLine(gx, K.DATA_BOT, K.GSUR_Y, 0.10, K.C_GRAY);
  }

  // Re-draw column lines over grid
  for (const xv of [K.X.dm,K.X.sym,K.X.sdesc,K.X.elev,K.X.moist,K.X.dcpt]) {
    vLine(xv, K.DATA_BOT, K.GSUR_Y, xv===K.X.elev ? lh : ls);
  }
}

function drawGsBand(showLabel) {
  const lh = 1.45, ls = 0.70;
  box(K.X.left, K.GSUR_Y, K.X.dm   - K.X.left,  2.5,                      K.C_WHITE, K.C_WHITE);
  box(K.X.dm,   K.GSUR_Y, K.X.elev - K.X.dm,     K.GSUR_LINE_Y-K.GSUR_Y+1, K.C_WHITE, K.C_WHITE);
  box(K.X.elev, K.GSUR_Y, K.X.right- K.X.elev,   K.GSUR_LINE_Y-K.GSUR_Y+1, K.C_WHITE, K.C_WHITE);
  hLine(K.X.dm,   K.X.elev,  K.GSUR_LINE_Y, ls);
  hLine(K.X.elev, K.X.right, K.GSUR_LINE_Y, ls);
  const y0 = K.GSUR_Y - 2;
  const verts = [[K.X.left,lh],[K.X.dft,ls],[K.X.dm,ls],[K.X.sym,ls],
                 [K.X.sdesc,ls],[K.X.elev,lh],[K.X.moist,ls],[K.X.dcpt,ls],
                 [K.X.gw,lh],[K.X.right,lh]];
  for (const [xv,lw] of verts) vLine(xv, y0, K.GSUR_LINE_Y, lw);
  if (showLabel) {
    const gsCx = (K.X.dm + K.X.sdesc) / 2;
    const gsY  = (K.GSUR_Y + K.GSUR_LINE_Y) / 2 - 2;
    txt(gsCx, gsY, 'Ground Surface', { sz:7, col:K.C_BLUE, align:'center' });
  }
}

function drawHeaderValues(bhNum, job) {
  const lx = K.HDR_LABEL_X;
  const titleLabel = 'Test Hole Log:  ';
  const titleW     = sw(titleLabel, 14, true, true);
  txt(lx + titleW, 721.5, bhNum, { sz:14, bold:true, italic:true, col:K.C_BLUE });

  for (const [lbl, y, val] of [
    ['File:',          703.6, job.jobNumber    || ''],
    ['Project:',       689.2, job.projectName  || ''],
    ['Client:',        674.8, job.clientName   || ''],
    ['Site Location:', 660.4, job.locationName || job.siteLocation || ''],
  ]) {
    const lw = sw(lbl + ' ', 10, true, true);
    txt(lx + lw, y, val, { sz:10 });
  }
}

function drawFooterValues(job, borehole, pg, totalPg) {
  const lbV  = borehole.loggedBy   || job.loggedBy   || '';
  const mtV  = borehole.method     || job.method     || '';
  const dtV  = borehole.startDate  || borehole.date  || '';
  const dmV  = borehole.datum      || '';
  const figV = borehole.figureNumber || '';
  const lfX  = 54.1, rfX = 432.1, sz = 10;
  for (const [lbl, y, val] of [
    ['Logged:', 92.7, lbV], ['Method:', 78.2, mtV], ['Date:', 63.9, dtV]
  ]) {
    txt(lfX + sw(lbl + ' ', sz, true, true), y, val, { sz });
  }
  for (const [lbl, y, val] of [
    ['Datum:', 92.7, dmV], ['Figure Number:', 77.7, figV],
    ['Page:', 63.2, `${pg} of ${totalPg}`]
  ]) {
    txt(rfX + sw(lbl + ' ', sz, true, true), y, val, { sz });
  }
}

// ─── Soil layers ─────────────────────────────────────────────────────────────
function drawSoilLayers(entries) {
  const sorted = [...entries].sort((a,b) => a.depthFrom - b.depthFrom);
  sorted.forEach((e, i) => {
    const yTop = dy(e.depthFrom), yBot = dy(e.depthTo);
    if (yTop <= yBot) return;
    // Pattern driven by primary material (soilTypeComponents.pm) for accuracy
    const pat = e.symbolPattern || (e.soilTypeComponents && e.soilTypeComponents.pm) || e.soilType || '';
    drawPattern(pat, K.X.dm, yBot, K.X.sym, yTop);
    if (yBot > K.DATA_BOT) hLine(K.X.dm, K.X.sym, yBot, 0.5);
    // First entry not starting at ground surface → draw top boundary line too
    const origDf = parseFloat(e._origDepthFrom ?? e.depthFrom ?? 0);
    if (i === 0 && origDf > 0.001 && yTop < K.CONTENT_TOP - 0.5)
      hLine(K.X.dm, K.X.sym, yTop, 0.5);
  });
}

// ─── Descriptions ────────────────────────────────────────────────────────────
function wrapText(str, maxChars) {
  const words = str.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length <= maxChars) cur = (cur + ' ' + w).trim();
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawDescriptions(entries) {
  const PAD_L=8, PAD_R=8, PAD_T=4, PAD_B=4, DIAG=8;
  const DESC_L = K.X.sym, DESC_R = K.X.sdesc, ELEV_R = K.X.elev;
  const TX = DESC_L + PAD_L;
  const ELEV_CX = (DESC_R + ELEV_R) / 2;
  const MAX_W = DESC_R - PAD_R - TX;   // usable column width in pt
  const BL_SZ = 7;
  // Base sizes — will adapt per entry
  const SN_SZ_MAX = 10, SN_SZ_MIN = 7;
  const SD_SZ = 8;

  // Find largest font size where text fits in MAX_W
  function fitSz(text, font, max = SN_SZ_MAX, min = SN_SZ_MIN) {
    for (let sz = max; sz >= min; sz--) {
      try { if (font.widthOfTextAtSize(text, sz) <= MAX_W) return sz; } catch (_) {}
    }
    return min;
  }

  // Wrap text to column using character-count heuristic (per-size)
  function wrapAt(str, sz) {
    const charsPerPt = 0.54;              // approx char width at 1pt for Helvetica
    const maxCh = Math.max(8, Math.floor(MAX_W / (sz * charsPerPt)));
    return wrapText(str, maxCh);
  }

  function gatherLines(e, sz) {
    const lines = [];
    // description is already fully composed by EntryScreen; fall back to qual string for legacy data
    if (e.description) {
      lines.push(...wrapAt(e.description.trim(), sz));
    } else {
      const qual = [e.condition, e.moisture].filter(Boolean).join(', ');
      for (const part of [qual, e.notes].filter(Boolean))
        lines.push(...wrapAt(part.trim(), sz));
    }
    return lines;
  }

  const sorted = [...entries].sort((a,b) => a.depthFrom - b.depthFrom);
  let prevDescBot = null;

  sorted.forEach((e, ei) => {
    const yTop = dy(e.depthFrom), yBot = dy(e.depthTo);
    if (yTop <= yBot) return;
    const origDf = parseFloat(e._origDepthFrom ?? e.depthFrom ?? 0);

    // Depth label
    txt(ELEV_CX, yTop - BL_SZ - 1, `${parseFloat(e.depthFrom).toFixed(1)}`,
        { sz:BL_SZ, col:K.C_BLUE, align:'center' });
    if (yBot >= K.DATA_BOT) hLine(DESC_R, ELEV_R, yBot, 0.5);
    if (ei === 0 && origDf > 0.001 && yTop < K.CONTENT_TOP - 0.5)
      hLine(DESC_R, ELEV_R, yTop, 0.5);

    let descTop = (prevDescBot !== null && prevDescBot < yTop) ? prevDescBot : yTop;
    if (descTop <= K.DATA_BOT + PAD_B) { prevDescBot = K.DATA_BOT + PAD_B; return; }

    // Soil name — soilType now holds the composed title e.g. "SAND AND GRAVEL (Fill)"
    let soilNm = e.soilType || '';
    if (!soilNm) soilNm = (e.soilTypeComponents?.pm || '').toUpperCase();
    if ((e._origDepthFrom ?? e.depthFrom) < e.depthFrom) soilNm += ' (cont.)';

    // Adaptive title size
    const biFont = _fonts.BI || _fonts.B || _fonts.R;
    const snSz = fitSz(soilNm, biFont);
    const snLS = snSz + 2;

    const lines  = gatherLines(e, SD_SZ);
    const baseLS = SD_SZ + 2;

    // Required height with base spacing
    const needed = PAD_T + snSz + lines.length * baseLS + PAD_B;
    const avail  = descTop - Math.max(yBot, K.DATA_BOT + PAD_B);
    let descBot;

    if (needed <= avail) {
      descBot = yBot;
      if (yTop - yBot >= K.NARROW_H) hLine(DESC_L, DESC_R, descBot, 0.5);
    } else {
      descBot = Math.max(descTop - needed, K.DATA_BOT + PAD_B);
      _page.drawLine({ start:{x:DESC_L,y:yBot}, end:{x:DESC_L+DIAG,y:descBot}, thickness:0.75, color:rgb(...K.C_BLUE) });
      _page.drawLine({ start:{x:DESC_R,y:yBot}, end:{x:DESC_R-DIAG,y:descBot}, thickness:0.75, color:rgb(...K.C_BLUE) });
      hLine(DESC_L+DIAG, DESC_R-DIAG, descBot, 0.75, K.C_BLUE);
    }

    // Adaptive line spacing: spread lines to fill available text area
    const textAreaH = (descTop - PAD_T) - (descBot + PAD_B);
    const totalLines = lines.length;
    const adaptLS = totalLines > 0
      ? Math.min(baseLS + 2, Math.max(baseLS, (textAreaH - snSz - snLS) / Math.max(1, totalLines)))
      : baseLS;

    // Draw soil name (title)
    let yCur = descTop - PAD_T - snSz;
    if (yCur >= K.DATA_BOT + 2)
      txt(TX, yCur, soilNm, { sz:snSz, bold:true, italic:true, col:K.C_RED });
    yCur -= snLS;

    // Draw description lines with adaptive spacing
    for (const ln of lines) {
      if (yCur < descBot + PAD_B) break;
      txt(TX, yCur, ln, { sz:SD_SZ, col:K.C_BLUE });
      yCur -= adaptLS;
    }
    prevDescBot = descBot;
  });
  return prevDescBot;
}

// ─── DCPT ─────────────────────────────────────────────────────────────────────
function drawDcpt(dcptData) {
  if (!dcptData || !dcptData.length) return;
  const dcptW = K.X.dcpt - K.DCPT_X0;
  const pts = [];
  for (const row of dcptData) {
    const d = parseFloat(Array.isArray(row) ? row[0] : row.depth);
    const b = parseFloat(Array.isArray(row) ? row[1] : row.blows);
    const y = dy(d);
    if (y >= K.DATA_BOT - 0.5 && y <= K.CONTENT_TOP + 0.5) pts.push([d,b]);
  }
  if (!pts.length) return;
  pts.sort((a,b)=>a[0]-b[0]);

  // Draw polyline
  for (let i = 1; i < pts.length; i++) {
    const [d0,b0] = pts[i-1], [d1,b1] = pts[i];
    const x0 = K.DCPT_X0 + (Math.min(b0,K.DCPT_SCALE_MAX)/K.DCPT_SCALE_MAX)*dcptW;
    const x1 = K.DCPT_X0 + (Math.min(b1,K.DCPT_SCALE_MAX)/K.DCPT_SCALE_MAX)*dcptW;
    _page.drawLine({ start:{x:x0,y:dy(d0)}, end:{x:x1,y:dy(d1)},
                    thickness:0.8, color:rgb(0.063,0.251,0.627) });
  }

  // Dots + labels
  const LBL_SZ = 5.5;
  for (const [d,b] of pts) {
    const x = K.DCPT_X0 + (Math.min(b,K.DCPT_SCALE_MAX)/K.DCPT_SCALE_MAX)*dcptW;
    const yp = dy(d);
    _page.drawEllipse({ x, y:yp, xScale:1.2, yScale:1.2, color:rgb(...K.C_BLACK) });
    const lbl = b >= K.DCPT_SCALE_MAX ? `>${K.DCPT_SCALE_MAX}` : `${Math.round(b)}`;
    const lblX = x + 3;
    if (lblX + sw(lbl,LBL_SZ) < K.X.dcpt - 1)
      txt(lblX, yp-2, lbl, { sz:LBL_SZ });
    else
      txt(x-3, yp-2, lbl, { sz:LBL_SZ, align:'right' });
  }
}

// ─── Fine Content column ──────────────────────────────────────────────────────
// Draws FC% values in the Moisture Content column (K.X.elev → K.X.moist).
// Each reading: short hline above → centered value text → short hline below.
function drawFc(fcData) {
  if (!fcData || !fcData.length) return;
  const COL_L  = K.X.elev;
  const COL_R  = K.X.moist;
  const CX     = (COL_L + COL_R) / 2;
  const SZ     = 6;
  const HALF   = SZ * 0.55;   // half text height approx
  const TICK_H = 2;            // gap between tick line and text edge

  const sorted = [...fcData].sort((a, b) => {
    const da = parseFloat(a.depth ?? a[0]);
    const db = parseFloat(b.depth ?? b[0]);
    return da - db;
  });

  for (const row of sorted) {
    const d  = parseFloat(row.depth ?? row[0]);
    const v  = parseFloat(row.fc   ?? row[1]);
    if (isNaN(d) || isNaN(v)) continue;
    const y = dy(d);
    if (y < K.DATA_BOT + 2 || y > K.CONTENT_TOP) continue;

    const lbl = `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}`;
    // short divider lines above and below
    hLine(COL_L, COL_R, y + HALF + TICK_H, 0.6, K.C_BLUE);
    hLine(COL_L, COL_R, y - HALF - TICK_H, 0.6, K.C_BLUE);
    // centered value
    txt(CX, y - SZ * 0.4, lbl, { sz:SZ, col:K.C_BLUE, align:'center' });
  }
}

// ─── Groundwater ──────────────────────────────────────────────────────────────
function drawGroundwater(gw) {
  if (gw == null || gw === '') return;
  const gwF = parseFloat(gw);
  if (isNaN(gwF) || !isFinite(gwF)) return;
  const y = dy(gwF);
  if (y < K.DATA_BOT + 10 || y > K.CONTENT_TOP) return;
  const cx = (K.X.dcpt + K.X.gw) / 2, TH=6, TW=5;
  _page.drawLine({ start:{x:cx-TW,y}, end:{x:cx,y:y-TH}, thickness:1, color:rgb(...K.C_BLACK) });
  _page.drawLine({ start:{x:cx+TW,y}, end:{x:cx,y:y-TH}, thickness:1, color:rgb(...K.C_BLACK) });
  _page.drawLine({ start:{x:cx-TW,y}, end:{x:cx+TW,y},   thickness:1, color:rgb(...K.C_BLACK) });
  txt(cx, y-TH-7, `GW=${gwF.toFixed(1)}m`, { sz:7, col:K.C_BLUE, align:'center' });
}

// ─── Remarks ──────────────────────────────────────────────────────────────────
function drawRemarks(entries) {
  const rx = K.X.gw + 4, SZ = 6.5, LS = 8.5;
  const WW = Math.max(10, Math.floor((K.X.right - 4 - rx) / 4));
  const sorted = [...entries].sort((a,b)=>a.depthFrom-b.depthFrom);
  for (const e of sorted) {
    const remark = (e.remarks || e.remark || '').trim();
    if (!remark) continue;
    let yCur = dy(e.depthFrom) - 5;
    for (const ln of wrapText(remark, WW)) {
      if (yCur < K.DATA_BOT + 3) break;
      txt(rx, yCur, ln, { sz:SZ }); yCur -= LS;
    }
  }
}

// ─── End of Borehole ─────────────────────────────────────────────────────────
function drawEob(depth, descBot, groundElev) {
  const geoY = dy(depth);
  let y = descBot != null ? Math.min(geoY, descBot) : geoY;
  y = Math.max(y, K.DATA_BOT + 10);
  const eobCx = (K.X.sym + K.X.sdesc) / 2;
  const depthFt = depth * 3.28084;
  const label = `End of Borehole @ ${depth.toFixed(1)}m (${depthFt.toFixed(1)}ft)`;
  txt(eobCx, y - 8, label, { sz:7, italic:true, align:'center' });
  // Depth and elevation labels at EOB boundary in the depth_elev column
  // BL_SZ=7 matches drawDescriptions boundary label size; both use C_BLUE
  const BL_SZ = 7, SZ_E = 6;
  const elevCx = (K.X.sdesc + K.X.elev) / 2;
  txt(elevCx, geoY - BL_SZ - 1, depth.toFixed(1), { sz:BL_SZ, col:K.C_BLUE, align:'center' });
  if (groundElev != null && !isNaN(groundElev)) {
    const rl = groundElev - depth;
    txt(elevCx, geoY + 1, rl.toFixed(2), { sz:SZ_E, align:'center', col:K.C_BLUE });
  }
}

// ─── Elevation labels in depth_elev column ───────────────────────────────────
function drawElevations(entries, groundElev, pageStart, pageEnd) {
  if (groundElev == null || isNaN(groundElev)) return;
  const elevCx = (K.X.sdesc + K.X.elev) / 2;
  const SZ = 6;
  const MIN_SEP = 8; // minimum pt gap between successive labels

  // Collect unique depths: page top + each original (unclipped) entry boundary
  const depthSet = new Set([pageStart]);
  for (const e of entries) {
    const orig = parseFloat(e._origDepthFrom ?? e.depthFrom ?? 0);
    if (orig > pageStart && orig < pageEnd) depthSet.add(orig);
  }
  const depths = [...depthSet].sort((a,b) => a - b);

  let lastY = null;
  for (const d of depths) {
    const rl = groundElev - d;
    const gsY   = (K.GSUR_Y + K.GSUR_LINE_Y) / 2 - 2; // centre of Ground Surface band
    const drawY = d === pageStart ? gsY : dy(d) + 1;
    const upper = d === pageStart ? K.GSUR_LINE_Y : K.CONTENT_TOP + 1;
    if (drawY <= K.DATA_BOT + 4 || drawY > upper) continue;
    if (lastY !== null && Math.abs(drawY - lastY) < MIN_SEP) continue;
    txt(elevCx, drawY, rl.toFixed(2), { sz:SZ, align:'center', col:K.C_BLUE });
    lastY = drawY;
  }
}

// ─── Page clip entries ────────────────────────────────────────────────────────
function pageClipEntries(entries, pageStart, pageEnd) {
  const result = [];
  for (const e of entries) {
    const df = parseFloat(e.depthFrom || 0);
    const dt = parseFloat(e.depthTo   || 0);
    if (df >= pageEnd || dt <= pageStart) continue;
    result.push({
      ...e,
      _origDepthFrom: df,
      depthFrom: Math.max(df, pageStart),
      depthTo:   Math.min(dt, pageEnd),
    });
  }
  return result;
}

// ─── Main render entry point ──────────────────────────────────────────────────
export async function renderBorehole(job, borehole) {
  // Load template PDF from assets (avoids large JS string literal issues with Hermes)
  const asset = Asset.fromModule(require('../../assets/template.pdf'));
  await asset.downloadAsync();
  const b64 = await FileSystem.readAsStringAsync(asset.localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const tplBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));

  // Embed fonts
  const masterDoc = await PDFDocument.create();
  _fonts = {
    n:  await masterDoc.embedFont(StandardFonts.Helvetica),
    b:  await masterDoc.embedFont(StandardFonts.HelveticaBold),
    i:  await masterDoc.embedFont(StandardFonts.HelveticaOblique),
    bi: await masterDoc.embedFont(StandardFonts.HelveticaBoldOblique),
  };

  const entries    = borehole.entries || [];
  const bhNum      = borehole.boreholeNumber || 'BH';
  const depthVals  = entries.map(e => parseFloat(e.depthTo || 0)).filter(v => !isNaN(v) && isFinite(v));
  let totalDepth   = Math.max(...depthVals, 10);
  if (!isFinite(totalDepth) || isNaN(totalDepth)) totalDepth = 10;
  if (borehole.totalDepth) {
    const td = parseFloat(borehole.totalDepth);
    if (!isNaN(td) && isFinite(td)) totalDepth = Math.max(totalDepth, td);
  }

  const dcptData = borehole.dcpt || entries.flatMap(e => e.dcptRows || []);

  // Pagination — short borehole: scale to actual depth+1m
  const effectiveDepth = totalDepth < K.MAX_PER_PAGE
    ? totalDepth + 1.0
    : K.MAX_PER_PAGE + 1.0 / 3.28084;
  const DATA_AREA_H = K.CONTENT_TOP - K.DATA_BOT;
  _ptPerM  = DATA_AREA_H / effectiveDepth;
  _ptPerFt = _ptPerM / 3.28084;
  const nPages = Math.max(1, Math.ceil(totalDepth / K.MAX_PER_PAGE));

  const finalDoc = await PDFDocument.create();

  for (let pgIdx = 0; pgIdx < nPages; pgIdx++) {
    const pageStart = pgIdx * K.MAX_PER_PAGE;
    const pageEnd   = Math.min((pgIdx+1) * K.MAX_PER_PAGE, totalDepth);
    _pageStart = pageStart;

    // Copy fresh template page
    const tplDoc = await PDFDocument.load(tplBytes);
    const [copiedTpl] = await finalDoc.copyPages(tplDoc, [0]);
    finalDoc.addPage(copiedTpl);
    _page = finalDoc.getPage(pgIdx);

    // Re-embed fonts for this page's doc context (fonts already embedded in finalDoc)
    _fonts = {
      n:  await finalDoc.embedFont(StandardFonts.Helvetica),
      b:  await finalDoc.embedFont(StandardFonts.HelveticaBold),
      i:  await finalDoc.embedFont(StandardFonts.HelveticaOblique),
      bi: await finalDoc.embedFont(StandardFonts.HelveticaBoldOblique),
    };

    const pageEntries = pageClipEntries(entries, pageStart, pageEnd);

    drawWhiteout();
    drawDataStructure();
    drawGsBand(pgIdx === 0);
    drawHeaderValues(bhNum, job);
    drawFooterValues(job, borehole, pgIdx + 1, nPages);

    let descBot = null;
    if (pageEntries.length) {
      drawSoilLayers(pageEntries);
      descBot = drawDescriptions(pageEntries);
    }
    drawDcpt(dcptData);
    drawGroundwater(borehole.groundwaterDepth);
    if (pageEntries.length) drawRemarks(pageEntries);
    const gndElev = parseFloat(borehole.groundElevation);
    drawElevations(pageEntries, isNaN(gndElev) ? null : gndElev, pageStart, pageEnd);
    if (pgIdx === nPages - 1) drawEob(totalDepth, descBot, isNaN(gndElev) ? null : gndElev);
  }

  return await finalDoc.save();
}
