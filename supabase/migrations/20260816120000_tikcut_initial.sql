create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  transcript text not null default '',
  trim_start numeric not null default 0 check (trim_start >= 0),
  trim_end numeric not null default 0 check (trim_end >= 0),
  caption_style text not null default 'impact' check (caption_style in ('impact','clean','karaoke')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  start_seconds numeric not null check (start_seconds >= 0),
  end_seconds numeric not null check (end_seconds > start_seconds),
  score integer check (score between 0 and 100),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists projects_user_updated_idx on public.projects(user_id, updated_at desc);
create index if not exists clips_project_idx on public.clips(project_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.clips enable row level security;

create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "projects_select_own" on public.projects for select to authenticated using ((select auth.uid()) = user_id);
create policy "projects_insert_own" on public.projects for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "projects_update_own" on public.projects for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "projects_delete_own" on public.projects for delete to authenticated using ((select auth.uid()) = user_id);

create policy "clips_select_own" on public.clips for select to authenticated using ((select auth.uid()) = user_id);
create policy "clips_insert_own" on public.clips for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "clips_update_own" on public.clips for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "clips_delete_own" on public.clips for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.clips to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-media', 'project-media', false, 2147483648)
on conflict (id) do update set public = false;

create policy "media_select_own" on storage.objects for select to authenticated
using (bucket_id = 'project-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media_insert_own" on storage.objects for insert to authenticated
with check (bucket_id = 'project-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media_update_own" on storage.objects for update to authenticated
using (bucket_id = 'project-media' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'project-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media_delete_own" on storage.objects for delete to authenticated
using (bucket_id = 'project-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

create index if not exists clips_user_idx on public.clips(user_id);
