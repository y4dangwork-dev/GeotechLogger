/**
 * AGS4 Export Utility
 * Generates AGS Data Format v4 (.ags) from GeoTechLogger job/borehole data.
 * Groups: PROJ, LOCA, GEOL, TPIN (DCP)
 */

function esc(s) {
  return String(s ?? '').replace(/"/g, '""');
}

function row(...fields) {
  return fields.map(f => `"${esc(f)}"`).join(',');
}

function fmt2(v) {
  const n = parseFloat(v);
  return isNaN(n) ? '' : n.toFixed(2);
}

export function generateAGS4(job, boreholes) {
  const lines = [];
  const FILE_FSET = 'AGS4';

  // ── PROJ ──────────────────────────────────────────────────────────────────
  lines.push(row('GROUP', 'PROJ'));
  lines.push(row('HEADING', 'PROJ_ID', 'PROJ_NAME', 'PROJ_LOC', 'PROJ_CLIENT',
                             'PROJ_ENG', 'PROJ_MEMO', 'FILE_FSET'));
  lines.push(row('UNIT', '', '', '', '', '', '', ''));
  lines.push(row('TYPE', 'ID', 'X', 'X', 'X', 'X', 'X', 'X'));
  lines.push(row(
    'DATA',
    job.jobNumber    || '',
    job.projectName  || '',
    job.locationName || job.siteLocation || '',
    job.clientName   || '',
    job.loggedBy     || '',
    job.notes        || '',
    FILE_FSET,
  ));
  lines.push('');

  // ── LOCA ──────────────────────────────────────────────────────────────────
  lines.push(row('GROUP', 'LOCA'));
  lines.push(row('HEADING', 'LOCA_ID', 'LOCA_TYPE', 'LOCA_STAT',
                             'LOCA_NATE', 'LOCA_NATN',
                             'LOCA_FDEP', 'LOCA_ELEV', 'LOCA_GL',
                             'LOCA_DATM', 'LOCA_REM', 'FILE_FSET'));
  lines.push(row('UNIT', '', '', '', 'm', 'm', 'm', 'mAD', 'mAD', '', '', ''));
  lines.push(row('TYPE', 'ID', 'PA', 'PA', '2DP', '2DP', '2DP', '2DP', '2DP', 'X', 'X', 'X'));

  for (const bh of boreholes) {
    const entries    = bh.entries || [];
    const totalDepth = bh.totalDepth
      ? parseFloat(bh.totalDepth)
      : Math.max(0, ...entries.map(e => parseFloat(e.depthTo || 0)));
    const elev = bh.groundElevation != null ? fmt2(bh.groundElevation) : '';
    const lat  = bh.latitude  != null ? fmt2(bh.latitude)  : '';
    const lng  = bh.longitude != null ? fmt2(bh.longitude) : '';

    lines.push(row(
      'DATA',
      bh.boreholeNumber || '',
      'BH',
      'U',
      lng,           // LOCA_NATE (Easting / Longitude)
      lat,           // LOCA_NATN (Northing / Latitude)
      fmt2(totalDepth),
      elev,          // LOCA_ELEV
      elev,          // LOCA_GL (ground level)
      bh.datum       || '',
      bh.remarks     || '',
      FILE_FSET,
    ));
  }
  lines.push('');

  // ── GEOL ──────────────────────────────────────────────────────────────────
  lines.push(row('GROUP', 'GEOL'));
  lines.push(row('HEADING', 'LOCA_ID', 'GEOL_TOP', 'GEOL_BASE',
                             'GEOL_DESC', 'GEOL_LEG', 'GEOL_STAT',
                             'GEOL_REM', 'FILE_FSET'));
  lines.push(row('UNIT', '', 'm', 'm', '', '', '', '', ''));
  lines.push(row('TYPE', 'ID', '2DP', '2DP', 'X', 'X', 'X', 'X', 'X'));

  for (const bh of boreholes) {
    const sorted = [...(bh.entries || [])].sort((a, b) =>
      parseFloat(a.depthFrom) - parseFloat(b.depthFrom));

    for (const e of sorted) {
      const parts = [e.condition, e.moisture, e.description]
        .filter(Boolean).join('. ');
      lines.push(row(
        'DATA',
        bh.boreholeNumber || '',
        fmt2(e.depthFrom),
        fmt2(e.depthTo),
        parts,
        e.soilType || '',
        e.soilType || '',
        e.remarks  || '',
        FILE_FSET,
      ));
    }
  }
  lines.push('');

  // ── TPIN (Dynamic Cone Penetration) ───────────────────────────────────────
  const allDcpt = boreholes.some(bh => {
    const rows = bh.dcpt
      || (bh.entries || []).flatMap(e => e.dcptRows || []);
    return rows.length > 0;
  });

  if (allDcpt) {
    lines.push(row('GROUP', 'TPIN'));
    lines.push(row('HEADING', 'LOCA_ID', 'TPIN_TESN', 'TPIN_TOP',
                               'TPIN_NVAL', 'TPIN_REM', 'FILE_FSET'));
    lines.push(row('UNIT', '', '', 'm', 'blows/300mm', '', ''));
    lines.push(row('TYPE', 'ID', 'X', '2DP', '2DP', 'X', 'X'));

    for (const bh of boreholes) {
      const dcptRows = bh.dcpt
        || (bh.entries || []).flatMap(e => e.dcptRows || []);
      const sorted = [...dcptRows].sort((a, b) => {
        const da = parseFloat(Array.isArray(a) ? a[0] : a.depth);
        const db = parseFloat(Array.isArray(b) ? b[0] : b.depth);
        return da - db;
      });

      for (const r of sorted) {
        const depth = parseFloat(Array.isArray(r) ? r[0] : r.depth);
        const blows = parseFloat(Array.isArray(r) ? r[1] : r.blows);
        if (isNaN(depth) || isNaN(blows)) continue;
        lines.push(row(
          'DATA',
          bh.boreholeNumber || '',
          'DCP-1',
          fmt2(depth),
          blows.toFixed(0),
          '',
          FILE_FSET,
        ));
      }
    }
    lines.push('');
  }

  // AGS4 uses CRLF line endings
  return lines.join('\r\n');
}
