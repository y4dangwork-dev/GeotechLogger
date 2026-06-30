// ─── Supabase config ──────────────────────────────────────────────────────────
const SUPABASE_URL  = 'https://hsntuqzxqxnblomfmhod.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzbnR1cXp4cXhuYmxvbWZtaG9kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0NDI4MzMsImV4cCI6MjA5ODAxODgzM30.PaU5nU8wDNYrOVTvhnON_W1MiNNRKW7NleiyjlUMmH0';

const HEADERS = {
  'Content-Type':  'application/json',
  'apikey':        SUPABASE_ANON,
  'Authorization': `Bearer ${SUPABASE_ANON}`,
  'Prefer':        'return=representation',
};

// ─── Community Jobs ───────────────────────────────────────────────────────────

export async function getCommunityJobs() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/community_jobs?select=*&order=published_at.desc`,
    { headers: HEADERS }
  );
  if (!r.ok) throw new Error(`Supabase error ${r.status}`);
  return r.json();
}

export async function publishJob(job, boreholes = []) {
  // Strip internal IDs, keep only data needed for read-only display
  const boreholes_data = boreholes.map(bh => ({
    boreholeNumber:   bh.boreholeNumber,
    date:             bh.date,
    datum:            bh.datum,
    figureNumber:     bh.figureNumber,
    groundElevation:  bh.groundElevation,
    groundwaterDepth: bh.groundwaterDepth,
    loggedBy:         bh.loggedBy,
    method:           bh.method,
    latitude:         bh.latitude,
    longitude:        bh.longitude,
    totalDepth:       bh.totalDepth,
    entries: (bh.entries || []).map(e => ({
      depthFrom:   e.depthFrom,
      depthTo:     e.depthTo,
      soilType:    e.soilType,
      condition:   e.condition,
      moisture:    e.moisture,
      description: e.description,
      remarks:     e.remarks,
    })),
    dcpt: (bh.dcpt || []).map(r => ({ depth: r.depth, blows: r.blows })),
  }));

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/community_jobs`,
    {
      method:  'POST',
      headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        id:             job.id,
        job_number:     job.jobNumber    || '',
        project_name:   job.projectName  || '',
        client_name:    job.clientName   || '',
        location_name:  job.locationName || '',
        logged_by:      job.loggedBy     || '',
        latitude:       job.latitude,
        longitude:      job.longitude,
        borehole_count: boreholes.length,
        boreholes_data,
        published_at:   new Date().toISOString(),
      }),
    }
  );
  if (!r.ok) throw new Error(`Supabase error ${r.status}`);
  return r.json();
}

export async function getCommunityJobDetail(jobId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/community_jobs?id=eq.${encodeURIComponent(jobId)}&select=*`,
    { headers: HEADERS }
  );
  if (!r.ok) throw new Error(`Supabase error ${r.status}`);
  const rows = await r.json();
  return rows[0] || null;
}

export async function unpublishJob(jobId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/community_jobs?id=eq.${encodeURIComponent(jobId)}`,
    { method: 'DELETE', headers: HEADERS }
  );
  if (!r.ok) throw new Error(`Supabase error ${r.status}`);
}
