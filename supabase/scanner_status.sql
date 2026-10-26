-- Run once in Supabase SQL Editor.
-- This table is intentionally separate from scan_events so heartbeats never
-- become fake tool scans in the existing checkout workflow.

create table if not exists public.scanner_status (
  device_id text primary key,
  transport text not null default 'Bluetooth Classic SPP',
  last_seen timestamptz not null default now()
);

alter table public.scanner_status enable row level security;

drop policy if exists "Scanner status public read" on public.scanner_status;
drop policy if exists "Scanner status bridge insert" on public.scanner_status;
drop policy if exists "Scanner status bridge update" on public.scanner_status;

create policy "Scanner status public read"
on public.scanner_status
for select
to anon, authenticated
using (true);

create policy "Scanner status bridge insert"
on public.scanner_status
for insert
to anon, authenticated
with check (true);

create policy "Scanner status bridge update"
on public.scanner_status
for update
to anon, authenticated
using (true)
with check (true);
