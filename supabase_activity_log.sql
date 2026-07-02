-- Run in Supabase SQL editor.
-- 1) Column needed for the "only the publisher can overwrite/remove" permission check
--    (part of the earlier community sync fix — skip if you already ran this).
alter table community_jobs
  add column if not exists owner_device_id text;

-- 2) Append-only activity log: records every publish / overwrite / unpublish,
--    who did it (device id), and what job it touched.
create table if not exists community_job_log (
  id              bigint generated always as identity primary key,
  job_id          text not null,
  action          text not null check (action in ('publish', 'overwrite', 'unpublish')),
  device_id       text,
  job_number      text,
  project_name    text,
  borehole_count  int,
  created_at      timestamptz not null default now()
);

create index if not exists community_job_log_job_id_idx on community_job_log (job_id);
create index if not exists community_job_log_device_id_idx on community_job_log (device_id);

-- The app uses the anon key, so RLS policies must explicitly allow it to
-- insert (write activity) and select (so you/admins can read the log back,
-- e.g. from Supabase Table Editor or a future in-app "Activity" screen).
alter table community_job_log enable row level security;

create policy "anon can insert activity log"
  on community_job_log for insert
  to anon
  with check (true);

create policy "anon can read activity log"
  on community_job_log for select
  to anon
  using (true);
