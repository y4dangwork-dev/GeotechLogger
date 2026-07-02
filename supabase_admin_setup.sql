-- Run in Supabase SQL editor, AFTER supabase_auth_setup.sql.
-- Adds a super-admin override: a short allow-list of emails that can
-- update/delete ANY community job (not just their own), for emergency
-- fixes from a phone with no access to the SQL editor / dashboard.
--
-- Idempotent — safe to re-run.

-- ─── 1) Admins allow-list ──────────────────────────────────────────────────
-- Keyed by email, not user_id: the admin may not have signed in yet (no
-- auth.users row to point to), and matching on the JWT's email at query time
-- avoids needing a backfill step once they do sign in.

create table if not exists public.admins (
  email      text primary key,
  added_at   timestamptz not null default now(),
  note       text
);

insert into public.admins (email, note) values
  ('dave.dang@geopacific.ca', 'super admin — emergency edit/delete on any community job')
on conflict (email) do nothing;

alter table public.admins enable row level security;

-- Nobody needs to read this table from the client; the is_admin() function
-- below runs as security definer and checks it server-side. No select policy
-- is added on purpose — the app should never query this table directly.

-- ─── 2) is_admin() — checks the signed-in user's email against the list ───

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt()->>'email', ''))
  );
$$;

-- ─── 3) Extend community_jobs update/delete policies with admin override ──

drop policy if exists "owner or editor can update their job" on community_jobs;
create policy "owner or editor can update their job"
  on community_jobs for update
  to authenticated
  using (
    auth.uid() = owner_user_id
    or exists (select 1 from community_job_editors e where e.job_id = community_jobs.id and e.user_id = auth.uid())
    or public.is_admin()
  )
  with check (
    auth.uid() = owner_user_id
    or exists (select 1 from community_job_editors e where e.job_id = community_jobs.id and e.user_id = auth.uid())
    or public.is_admin()
  );

drop policy if exists "owner or editor can delete their job" on community_jobs;
create policy "owner or editor can delete their job"
  on community_jobs for delete
  to authenticated
  using (
    auth.uid() = owner_user_id
    or exists (select 1 from community_job_editors e where e.job_id = community_jobs.id and e.user_id = auth.uid())
    or public.is_admin()
  );

-- Let an admin manage the editors list too (e.g. assign an EOR on someone
-- else's job), on top of the existing "owner can manage editors" policy.

drop policy if exists "admin can manage editors" on community_job_editors;
create policy "admin can manage editors"
  on community_job_editors for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ─── 4) Let is_admin() be called from the app to show/hide admin UI ───────
-- security definer functions aren't callable by clients by default in some
-- setups; grant explicitly so the app can ask "am I an admin?" and show an
-- "Admin" badge / unlock edit buttons accordingly. The function only ever
-- reveals a boolean about the *current* signed-in user — it can't be used to
-- probe other accounts.

grant execute on function public.is_admin() to authenticated;
