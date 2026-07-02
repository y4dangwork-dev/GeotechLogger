// ─── Supabase config ──────────────────────────────────────────────────────────
// Reads still go through a plain fetch() with the static anon key — the
// community_jobs SELECT policy allows anon, so this is fine and keeps reads
// simple/fast. Writes (publish/unpublish/log) now require RLS's `authenticated`
// role, which only carries through if the request is signed with the logged-in
// user's JWT — so those go through the official client in supabaseClient.js,
// which attaches that JWT automatically.
import { supabase } from './supabaseClient';

const SUPABASE_URL  = 'https://hsntuqzxqxnblomfmhod.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzbnR1cXp4cXhuYmxvbWZtaG9kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0NDI4MzMsImV4cCI6MjA5ODAxODgzM30.PaU5nU8wDNYrOVTvhnON_W1MiNNRKW7NleiyjlUMmH0';

const HEADERS = {
  'Content-Type':  'application/json',
  'apikey':        SUPABASE_ANON,
  'Authorization': `Bearer ${SUPABASE_ANON}`,
  'Prefer':        'return=representation',
};

// Surface the real Postgres/PostgREST error message (e.g. missing column,
// RLS rejection) instead of a bare status code, so failures are diagnosable.
async function throwForResponse(r) {
  let detail = '';
  try {
    const body = await r.json();
    detail = body?.message || body?.hint || body?.details || JSON.stringify(body);
  } catch {
    try { detail = await r.text(); } catch { /* ignore */ }
  }
  throw new Error(`Supabase error ${r.status}${detail ? `: ${detail}` : ''}`);
}

// ─── Community Jobs ───────────────────────────────────────────────────────────

export async function getCommunityJobs() {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/community_jobs?select=*&order=published_at.desc`,
    { headers: HEADERS }
  );
  if (!r.ok) return throwForResponse(r);
  return r.json();
}

// ownerDeviceId is kept for backward compatibility with rows published before
// login existed; owner_user_id/owner_email (from the signed-in session) are
// what RLS actually checks now.
export async function publishJob(job, boreholes = [], ownerDeviceId = null) {
  const { data: { user } = {} } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in to publish.');

  // Strip internal IDs, keep only data needed for read-only display.
  // Field names here must stay in sync with what JobScreen/BoreholeScreen/EntryScreen
  // read back from a community job (communityJob / communityBh / communityEntry).
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
      depthFrom:          e.depthFrom,
      depthTo:            e.depthTo,
      soilType:           e.soilType,
      soilTypeComponents: e.soilTypeComponents,
      condition:          e.condition,
      moisture:           e.moisture,
      description:        e.description,
      notes:              e.notes,
      remarks:            e.remarks,
    })),
    dcpt: (bh.dcpt || []).map(r => ({ depth: r.depth, blows: r.blows })),
    fc:   (bh.fc   || []).map(r => ({ depth: r.depth, fc: r.fc })),
  }));

  const { data, error } = await supabase
    .from('community_jobs')
    .upsert({
      id:              job.id,
      job_number:      job.jobNumber    || '',
      project_name:    job.projectName  || '',
      client_name:     job.clientName   || '',
      location_name:   job.locationName || '',
      logged_by:       job.loggedBy     || '',
      latitude:        job.latitude,
      longitude:       job.longitude,
      borehole_count:  boreholes.length,
      boreholes_data,
      owner_device_id: ownerDeviceId,
      owner_user_id:   user.id,
      owner_email:     user.email,
      published_at:    new Date().toISOString(),
    })
    .select();

  if (error) throw new Error(error.message || 'Publish failed');
  return data;
}

export async function getCommunityJobDetail(jobId) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/community_jobs?id=eq.${encodeURIComponent(jobId)}&select=*`,
    { headers: HEADERS }
  );
  if (!r.ok) return throwForResponse(r);
  const rows = await r.json();
  return rows[0] || null;
}

export async function unpublishJob(jobId) {
  const { error } = await supabase.from('community_jobs').delete().eq('id', jobId);
  if (error) throw new Error(error.message || 'Could not remove job');
}

// ─── Admin ─────────────────────────────────────────────────────────────────────
// Asks the server "is the currently signed-in user a super admin?" — backed by
// the admins allow-list + is_admin() function in supabase_admin_setup.sql. The
// allow-list itself is never exposed to the client, only this yes/no answer
// about the current session. Fails closed (returns false) on any error.
export async function isAdmin() {
  try {
    const { data, error } = await supabase.rpc('is_admin');
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}

// ─── EOR / job editors ──────────────────────────────────────────────────────
// Lets a job's owner grant edit rights on that specific job to someone else
// (e.g. an Engineer of Record) by email, backed by supabase_eor_setup.sql.
// The target person must have signed into the app at least once already —
// the server raises a clear error if not, which we just pass through.

export async function addJobEditor(jobId, email, role = 'eor') {
  const { error } = await supabase.rpc('add_job_editor_by_email', {
    p_job_id: jobId,
    p_email:  (email || '').trim().toLowerCase(),
    p_role:   role,
  });
  if (error) throw new Error(error.message || 'Could not add EOR');
}

export async function removeJobEditor(jobId, userId) {
  const { error } = await supabase.rpc('remove_job_editor', { p_job_id: jobId, p_user_id: userId });
  if (error) throw new Error(error.message || 'Could not remove EOR');
}

// Only succeeds (returns rows) for the job's owner or the editor themselves —
// see the "owner and editors can view editor list" RLS policy.
export async function listJobEditors(jobId) {
  const { data, error } = await supabase
    .from('community_job_editors')
    .select('*')
    .eq('job_id', jobId);
  if (error) throw new Error(error.message || 'Could not load EOR list');
  return data || [];
}

// Asks "can I (the signed-in user) edit this job as an assigned EOR?" —
// doesn't require owning the job or being able to read the editors table.
export async function isJobEditor(jobId) {
  try {
    const { data, error } = await supabase.rpc('is_job_editor', { p_job_id: jobId });
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}

// ─── Activity log ─────────────────────────────────────────────────────────────
// Append-only record of who published/overwrote/removed what, for auditing.
// Requires a `community_job_log` table — see supabase_activity_log.sql /
// supabase_auth_setup.sql. Logging is best-effort: callers should not let a
// logging failure block the actual publish/unpublish action, so this never
// throws — it resolves false on failure instead.
export async function logActivity({ jobId, action, deviceId, jobNumber, projectName, boreholeCount }) {
  try {
    const { data: { user } = {} } = await supabase.auth.getUser();
    const { error } = await supabase.from('community_job_log').insert({
      job_id:         jobId,
      action,                 // 'publish' | 'overwrite' | 'unpublish'
      device_id:      deviceId,
      user_id:        user?.id || null,
      user_email:     user?.email || null,
      job_number:     jobNumber     || '',
      project_name:   projectName   || '',
      borehole_count: boreholeCount ?? null,
    });
    return !error;
  } catch {
    return false;
  }
}
