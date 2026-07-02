// Lightweight reachability probe — no NetInfo dependency, just a fetch with a
// short timeout against our own Supabase project. We only care "can we reach
// our backend right now", not general internet status, and this avoids
// pulling in a native module just to answer that question.
const SUPABASE_URL = 'https://hsntuqzxqxnblomfmhod.supabase.co';

export async function isOnline(timeoutMs = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Any response (even a 404/401) means the network + host are reachable —
    // we don't care about the status code, only whether the request completed.
    await fetch(`${SUPABASE_URL}/auth/v1/health`, { method: 'GET', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
