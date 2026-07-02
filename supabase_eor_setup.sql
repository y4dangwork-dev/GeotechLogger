-- Run in Supabase SQL editor, AFTER supabase_admin_setup.sql.
-- Lets a job's owner (or a super admin) assign an "Engineer of Record" (or
-- any other reviewer role) to their job by email, using the
-- community_job_editors table that was already wired into the update/delete
-- RLS policies back in supabase_auth_setup.sql section 4 — this file is what
-- actually lets people populate that table from the app instead of the SQL
-- editor.
--
-- Idempotent — safe to re-run.

-- ─── 1) Store the email alongside the editor row ──────────────────────────
-- community_job_editors already has user_id; email is denormalized here so
-- the owner can see who's been added without needing to read auth.users
-- (which RLS wouldn't allow the client to query directly anyway).

alter table community_job_editors add column if not exists email text;

-- ─── 2) is_job_editor() ─────────────────────────────────────────────────────
-- Lets the app (and the two functions below) ask "is the current user
-- already an authorized editor/EOR on this job?" without needing to read
-- community_job_editors directly for jobs they don't own.

create or replace function public.is_job_editor(p_job_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from community_job_editors
    where job_id = p_job_id and user_id = auth.uid()
  );
$$;

grant execute on function public.is_job_editor(text) to authenticated;

-- ─── 3) add_job_editor_by_email() ──────────────────────────────────────────
-- Who can call this: the job owner, an admin, OR anyone already an
-- authorized editor on this job.
--
-- Assigning someone with role = 'eor' TRANSFERS OWNERSHIP: community_jobs.
-- owner_user_id/owner_email are updated to the new EOR, and whoever was the
-- previous owner is kept on as a plain 'editor' (not dropped — they keep
-- edit rights on the job, just not owner standing). Any other role (e.g.
-- 'editor', 'reviewer') just adds/updates a row in community_job_editors
-- without touching ownership.
--
-- The target person must already have an auth.users row — i.e. they must
-- have signed into the app at least once — since there's nothing to point
-- community_job_editors.user_id / community_jobs.owner_user_id at otherwise.
-- If they haven't, this raises a clear error telling the caller to have that
-- person sign in first.

create or replace function public.add_job_editor_by_email(p_job_id text, p_email text, p_role text default 'eor')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id      uuid;
  is_owner       boolean;
  prev_owner_id  uuid;
  prev_owner_em  text;
  role_norm      text := lower(coalesce(p_role, 'eor'));
begin
  select (owner_user_id = auth.uid()) into is_owner from community_jobs where id = p_job_id;

  if not coalesce(is_owner, false)
     and not public.is_admin()
     and not public.is_job_editor(p_job_id) then
    raise exception 'Only the job owner or an assigned EOR can add another editor.';
  end if;

  select id into target_id from auth.users where lower(email) = lower(p_email);

  if target_id is null then
    raise exception 'No account found for %. They need to sign into GeoTechLogger at least once before you can add them.', p_email;
  end if;

  insert into community_job_editors (job_id, user_id, role, added_by, email)
  values (p_job_id, target_id, role_norm, auth.uid(), lower(p_email))
  on conflict (job_id, user_id) do update set role = excluded.role, email = excluded.email;

  if role_norm = 'eor' then
    select owner_user_id, owner_email into prev_owner_id, prev_owner_em
      from community_jobs where id = p_job_id;

    update community_jobs
      set owner_user_id = target_id, owner_email = lower(p_email)
      where id = p_job_id;

    -- Keep the outgoing owner on as a regular editor rather than dropping
    -- their access entirely, unless they're the same person being promoted.
    if prev_owner_id is not null and prev_owner_id <> target_id then
      insert into community_job_editors (job_id, user_id, role, added_by, email)
      values (p_job_id, prev_owner_id, 'editor', auth.uid(), prev_owner_em)
      on conflict (job_id, user_id) do nothing;
    end if;
  end if;
end;
$$;

grant execute on function public.add_job_editor_by_email(text, text, text) to authenticated;

-- ─── 4) remove_job_editor() ─────────────────────────────────────────────────
-- Deliberately stricter than add: adding an editor only needs owner/EOR
-- standing, but REMOVING one else (kicking someone off a job) is admin-only.
-- Once someone is assigned as EOR they can't be bumped by the job owner or
-- another editor — only a super admin can undo that assignment. This is a
-- one-way trust model on purpose: it stops a dispute between owner and EOR
-- from turning into a removal fight.
--
-- The one exception: anyone can remove THEMSELVES (step down from a job).
-- To just downgrade your own role instead of leaving entirely, call
-- add_job_editor_by_email with your own email and a lower role (e.g.
-- 'editor') — that upserts your existing row rather than needing a separate
-- function, and is allowed since you're already an editor on the job.

create or replace function public.remove_job_editor(p_job_id text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id <> auth.uid() and not public.is_admin() then
    raise exception 'Only a super admin can remove someone else — you can only remove yourself.';
  end if;

  delete from community_job_editors where job_id = p_job_id and user_id = p_user_id;
end;
$$;

grant execute on function public.remove_job_editor(text, uuid) to authenticated;
