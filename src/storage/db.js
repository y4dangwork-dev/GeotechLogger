import AsyncStorage from '@react-native-async-storage/async-storage';

const JOBS_KEY = '@geotechlogger:jobs';

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

async function loadJobs() {
  try {
    const raw = await AsyncStorage.getItem(JOBS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function saveJobs(jobs) {
  await AsyncStorage.setItem(JOBS_KEY, JSON.stringify(jobs));
}

export const DB = {
  async getJobs() { return loadJobs(); },

  async createJob(data) {
    const jobs = await loadJobs();
    const job = { id: uuid(), ...data, boreholes: [], createdAt: Date.now() };
    jobs.unshift(job);
    await saveJobs(jobs);
    return job;
  },

  async updateJob(id, data) {
    const jobs = await loadJobs();
    const i = jobs.findIndex(j => j.id === id);
    if (i >= 0) { jobs[i] = { ...jobs[i], ...data }; await saveJobs(jobs); }
  },

  async deleteJob(id) {
    const jobs = (await loadJobs()).filter(j => j.id !== id);
    await saveJobs(jobs);
  },

  async getJob(id) {
    return (await loadJobs()).find(j => j.id === id) || null;
  },

  async getBoreholes(jobId) {
    const job = await DB.getJob(jobId);
    return job?.boreholes || [];
  },

  async createBorehole(jobId, data) {
    const jobs = await loadJobs();
    const job  = jobs.find(j => j.id === jobId);
    if (!job) return null;
    const bh = { id: uuid(), ...data, entries: [], dcpt: [], createdAt: Date.now() };
    job.boreholes = job.boreholes || [];
    job.boreholes.unshift(bh);
    await saveJobs(jobs);
    return bh;
  },

  async updateBorehole(jobId, bhId, data) {
    const jobs = await loadJobs();
    const job  = jobs.find(j => j.id === jobId);
    if (!job) return;
    const i = (job.boreholes || []).findIndex(b => b.id === bhId);
    if (i >= 0) { job.boreholes[i] = { ...job.boreholes[i], ...data }; await saveJobs(jobs); }
  },

  async deleteBorehole(jobId, bhId) {
    const jobs = await loadJobs();
    const job  = jobs.find(j => j.id === jobId);
    if (!job) return;
    job.boreholes = (job.boreholes || []).filter(b => b.id !== bhId);
    await saveJobs(jobs);
  },

  async getBorehole(jobId, bhId) {
    const bhs = await DB.getBoreholes(jobId);
    return bhs.find(b => b.id === bhId) || null;
  },

  // ── DCPT readings: stored as array of {depth, blows} on the borehole ────────
  async addDcptReading(jobId, bhId, depth, blows) {
    const jobs = await loadJobs();
    const job  = jobs.find(j => j.id === jobId);
    if (!job) return;
    const bh = (job.boreholes||[]).find(b => b.id === bhId);
    if (!bh) return;
    bh.dcpt = bh.dcpt || [];
    bh.dcpt.push({ depth: parseFloat(depth), blows: parseInt(blows, 10) });
    bh.dcpt.sort((a,b) => a.depth - b.depth);
    await saveJobs(jobs);
  },

  async deleteDcptReading(jobId, bhId, index) {
    const jobs = await loadJobs();
    const job  = jobs.find(j => j.id === jobId);
    if (!job) return;
    const bh = (job.boreholes||[]).find(b => b.id === bhId);
    if (!bh) return;
    bh.dcpt = (bh.dcpt||[]).filter((_,i) => i !== index);
    await saveJobs(jobs);
  },

  async replaceDcpt(jobId, bhId, readings) {
    // readings: [{depth, blows}, ...]
    const jobs = await loadJobs();
    const job  = jobs.find(j => j.id === jobId);
    if (!job) return;
    const bh = (job.boreholes||[]).find(b => b.id === bhId);
    if (!bh) return;
    bh.dcpt = readings.slice().sort((a,b) => a.depth - b.depth);
    await saveJobs(jobs);
  },

  // ── Fine Content readings: stored as array of {depth, fc} on the borehole ───
  async addFcReading(jobId, bhId, depth, fc) {
    const jobs = await loadJobs();
    const job  = jobs.find(j => j.id === jobId);
    if (!job) return;
    const bh = (job.boreholes||[]).find(b => b.id === bhId);
    if (!bh) return;
    bh.fc = bh.fc || [];
    bh.fc.push({ depth: parseFloat(depth), fc: parseFloat(fc) });
    bh.fc.sort((a,b) => a.depth - b.depth);
    await saveJobs(jobs);
  },

  async deleteFcReading(jobId, bhId, index) {
    const jobs = await loadJobs();
    const job  = jobs.find(j => j.id === jobId);
    if (!job) return;
    const bh = (job.boreholes||[]).find(b => b.id === bhId);
    if (!bh) return;
    bh.fc = (bh.fc||[]).filter((_,i) => i !== index);
    await saveJobs(jobs);
  },

  async createEntry(jobId, bhId, data) {
    const jobs = await loadJobs();
    const job  = jobs.find(j => j.id === jobId);
    if (!job) return;
    const bh = (job.boreholes||[]).find(b => b.id === bhId);
    if (!bh) return;
    const entry = { id: uuid(), ...data };
    bh.entries = bh.entries || [];
    bh.entries.push(entry);
    await saveJobs(jobs);
    return entry;
  },

  async updateEntry(jobId, bhId, entryId, data) {
    const jobs = await loadJobs();
    const job  = jobs.find(j => j.id === jobId);
    if (!job) return;
    const bh = (job.boreholes||[]).find(b => b.id === bhId);
    if (!bh) return;
    const i = (bh.entries||[]).findIndex(e => e.id === entryId);
    if (i >= 0) { bh.entries[i] = { ...bh.entries[i], ...data }; await saveJobs(jobs); }
  },

  async deleteEntry(jobId, bhId, entryId) {
    const jobs = await loadJobs();
    const job  = jobs.find(j => j.id === jobId);
    if (!job) return;
    const bh = (job.boreholes||[]).find(b => b.id === bhId);
    if (!bh) return;
    bh.entries = (bh.entries||[]).filter(e => e.id !== entryId);
    await saveJobs(jobs);
  },
};
