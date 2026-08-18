create table if not exists public.tikcut_projects (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  transcript text not null default '',
  trim_start numeric not null default 0 check (trim_start >= 0),
  trim_end numeric not null default 0 check (trim_end >= 0),
  caption_style text not null default 'impact' check (caption_style in ('impact','clean','karaoke')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tikcut_projects_user_updated_idx
  on public.tikcut_projects(user_id, updated_at desc);

alter table public.tikcut_projects enable row level security;

revoke all on public.tikcut_projects from anon;
grant select, insert, update, delete on public.tikcut_projects to authenticated;

drop policy if exists tikcut_projects_select_own on public.tikcut_projects;
drop policy if exists tikcut_projects_insert_own on public.tikcut_projects;
drop policy if exists tikcut_projects_update_own on public.tikcut_projects;
drop policy if exists tikcut_projects_delete_own on public.tikcut_projects;

create policy tikcut_projects_select_own
  on public.tikcut_projects for select to authenticated
  using ((select auth.uid()) = user_id);

create policy tikcut_projects_insert_own
  on public.tikcut_projects for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy tikcut_projects_update_own
  on public.tikcut_projects for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy tikcut_projects_delete_own
  on public.tikcut_projects for delete to authenticated
  using ((select auth.uid()) = user_id);
