-- Run in Supabase SQL editor, AFTER supabase_activity_log.sql.
-- Sets up: (1) domain-restricted login, (2) real per-user ownership on
-- community_jobs, (3) RLS so only the publisher can update/delete their job.

-- ─── 1) Restrict sign-ups / logins to @geopacific.ca ──────────────────────────
-- This runs inside the database, before a row is inserted into auth.users,
-- so it applies no matter how the request reaches Supabase (app, curl, etc.).
-- Supabase's email OTP flow creates the auth.users row on first sign-in, so
-- blocking the insert here effectively blocks sign-up/sign-in in one place.

create or replace function public.enforce_geopacific_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null or new.email !~* '^[^@]+@geopacific\.ca$' then
    raise exception 'Sign-in is restricted to @geopacific.ca email addresses';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_geopacific_email_trigger on auth.users;

create trigger enforce_geopacific_email_trigger
  before insert on auth.users
  for each row
  execute function public.enforce_geopacific_email();

-- ─── 2) Real per-user ownership on community_jobs ─────────────────────────────
-- owner_device_id (added earlier) was self-reported by the client and could be
-- spoofed. owner_user_id is the actual authenticated user (auth.uid()) and is
-- what RLS below enforces server-side. Keep owner_device_id for now so old
-- rows / the pre-login app flow don't break; new writes should set both.

alter table community_jobs
  add column if not exists owner_user_id uuid references auth.users(id);

alter table community_jobs
  add column if not exists owner_email text;

create index if not exists community_jobs_owner_user_id_idx
  on community_jobs (owner_user_id);

-- ─── 3) Row Level Security: only the publisher can update/delete their job ────
-- Everyone (including anon, if you still want public read before requiring
-- login) can read the list. Only a signed-in user can insert. Only the row's
-- owner can update or delete it.

alter table community_jobs enable row level security;

drop policy if exists "anyone can read community_jobs" on community_jobs;
create policy "anyone can read community_jobs"
  on community_jobs for select
  using (true);

drop policy if exists "signed-in users can publish" on community_jobs;
create policy "signed-in users can publish"
  on community_jobs for insert
  to authenticated
  with check (auth.uid() = owner_user_id);

-- update/delete policies are defined below in section 4, after
-- community_job_editors exists, so they can check "owner OR authorized
-- editor (e.g. EOR)".

-- ─── 4) Hook for future per-job roles (e.g. Engineer of Record) ───────────────
-- owner_user_id is a single "who published this" field — fine for ownership,
-- but a job may later need other people with edit rights on that specific job
-- (an EOR signing off, a reviewer, etc.) without transferring ownership. Rather
-- than bolt more single-user columns onto community_jobs later, add a proper
-- join table now: one job can have any number of authorized editors, each with
-- a role label. No app UI uses this yet — it's just wired into the RLS checks
-- below so turning it on later is a data change, not a policy rewrite.

create table if not exists community_job_editors (
  job_id     text not null references community_jobs(id) on delete cascade,
  user_id    uuid not null references auth.users(id),
  role       text not null default 'editor', -- e.g. 'eor', 'reviewer', 'editor'
  added_by   uuid references auth.users(id),
  added_at   timestamptz not null default now(),
  primary key (job_id, user_id)
);

alter table community_job_editors enable row level security;

drop policy if exists "owner and editors can view editor list" on community_job_editors;
create policy "owner and editors can view editor list"
  on community_job_editors for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (select 1 from community_jobs j where j.id = job_id and j.owner_user_id = auth.uid())
  );

-- Only the job owner can grant/revoke editor access for now. (If EOR
-- assignment should later be done by an admin instead of the owner, swap this
-- check for an admin-role check without touching anything else.)
drop policy if exists "owner can manage editors" on community_job_editors;
create policy "owner can manage editors"
  on community_job_editors for all
  to authenticated
  using (exists (select 1 from community_jobs j where j.id = job_id and j.owner_user_id = auth.uid()))
  with check (exists (select 1 from community_jobs j where j.id = job_id and j.owner_user_id = auth.uid()));

-- Now the real update/delete policies: owner OR anyone listed as an
-- authorized editor (EOR, reviewer, etc.) for that specific job.

drop policy if exists "owner can update their job" on community_jobs;
drop policy if exists "owner or editor can update their job" on community_jobs;
create policy "owner or editor can update their job"
  on community_jobs for update
  to authenticated
  using (
    auth.uid() = owner_user_id
    or exists (select 1 from community_job_editors e where e.job_id = community_jobs.id and e.user_id = auth.uid())
  )
  with check (
    auth.uid() = owner_user_id
    or exists (select 1 from community_job_editors e where e.job_id = community_jobs.id and e.user_id = auth.uid())
  );

drop policy if exists "owner can delete their job" on community_jobs;
drop policy if exists "owner or editor can delete their job" on community_jobs;
create policy "owner or editor can delete their job"
  on community_jobs for delete
  to authenticated
  using (
    auth.uid() = owner_user_id
    or exists (select 1 from community_job_editors e where e.job_id = community_jobs.id and e.user_id = auth.uid())
  );

-- ─── 5) Activity log: also record who (real user), not just device id ─────────

alter table community_job_log
  add column if not exists user_id uuid references auth.users(id);

alter table community_job_log
  add column if not exists user_email text;

-- Only signed-in users may write log rows now (matches the write policies above).
drop policy if exists "anon can insert activity log" on community_job_log;
drop policy if exists "signed-in users can insert activity log" on community_job_log;
create policy "signed-in users can insert activity log"
  on community_job_log for insert
  to authenticated
  with check (true);
