-- Multi-user access for the Aircraft Tools Workshop website.
-- Run once in Supabase SQL Editor after reviewing this file.
-- Auth accounts are Students by default. Promote trusted people by changing
-- public.user_access.role to 'admin' in Supabase Table Editor.

begin;

create table if not exists public.user_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'student' check (role in ('admin', 'student')),
  active boolean not null default true,
  position text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_access enable row level security;
alter table public.tools enable row level security;
alter table public.audit_logs enable row level security;
alter table public.borrow_history enable row level security;
alter table public.borrow_sessions enable row level security;
alter table public.scan_events enable row level security;

create or replace function public.has_active_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_access ua
    where ua.user_id = (select auth.uid())
      and ua.active = true
      and ua.role in ('admin', 'student')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_access ua
    where ua.user_id = (select auth.uid())
      and ua.active = true
      and ua.role = 'admin'
  );
$$;

revoke all on function public.has_active_access() from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.has_active_access() to authenticated;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "Users can read own access" on public.user_access;
drop policy if exists "Admins can read all access" on public.user_access;
create policy "Users can read own access"
on public.user_access for select to authenticated
using (user_id = (select auth.uid()));
create policy "Admins can read all access"
on public.user_access for select to authenticated
using (public.is_admin());

revoke all on public.user_access from anon, authenticated;
grant select on public.user_access to authenticated;

-- Give existing accounts a role. Only the existing owner account is Admin;
-- every other existing/new account starts as Student.
insert into public.user_access (user_id, role, active)
select u.id,
       case when lower(u.email) = 'muzwazir@gmail.com' then 'admin' else 'student' end,
       true
from auth.users u
on conflict (user_id) do nothing;

create or replace function public.assign_default_user_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_access (user_id, role, active)
  values (new.id, 'student', true)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.assign_default_user_access() from public, anon, authenticated;

drop trigger if exists assign_default_user_access on auth.users;
create trigger assign_default_user_access
after insert on auth.users
for each row execute function public.assign_default_user_access();

-- Remove the old single-email rules and the anonymous table access shown in
-- the policy report. RLS policies are combined with OR, so the old permissive
-- policies must be removed for the new rules to take effect.
drop policy if exists "Admin full access to audit logs" on public.audit_logs;
drop policy if exists "Allow public insert audit logs" on public.audit_logs;
drop policy if exists "Allow public read audit logs" on public.audit_logs;
drop policy if exists "Admin full access to borrow history" on public.borrow_history;
drop policy if exists "Allow public insert borrow history" on public.borrow_history;
drop policy if exists "Allow public read borrow history" on public.borrow_history;
drop policy if exists "Admin full access to borrow sessions" on public.borrow_sessions;
drop policy if exists "Allow public insert borrow sessions" on public.borrow_sessions;
drop policy if exists "Allow public read borrow sessions" on public.borrow_sessions;
drop policy if exists "Allow public update borrow sessions" on public.borrow_sessions;
drop policy if exists "Admin full access to scan events" on public.scan_events;
drop policy if exists "Allow public insert scan events" on public.scan_events;
drop policy if exists "Allow public read scan events" on public.scan_events;
drop policy if exists "Allow public update scan events" on public.scan_events;
drop policy if exists "Admin full access to tools" on public.tools;
drop policy if exists "Allow public delete tools" on public.tools;
drop policy if exists "Allow public read tools" on public.tools;
drop policy if exists "Allow public update tools" on public.tools;
drop policy if exists "Allow public insert tools" on public.tools;
drop policy if exists "Active users can read tool inventory" on public.tools;
drop policy if exists "Admins can manage tools" on public.tools;
drop policy if exists "Admins can manage audit logs" on public.audit_logs;
drop policy if exists "Admins can manage borrow history" on public.borrow_history;
drop policy if exists "Admins can manage borrow sessions" on public.borrow_sessions;
drop policy if exists "Admins can manage scan events" on public.scan_events;
drop policy if exists "Bluetooth bridge can insert scan events" on public.scan_events;

create policy "Active users can read tool inventory"
on public.tools for select to authenticated
using (public.has_active_access());
create policy "Admins can manage tools"
on public.tools for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy "Admins can manage audit logs"
on public.audit_logs for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy "Admins can manage borrow history"
on public.borrow_history for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy "Admins can manage borrow sessions"
on public.borrow_sessions for all to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy "Admins can manage scan events"
on public.scan_events for all to authenticated
using (public.is_admin()) with check (public.is_admin());
-- The Windows bridge uses the public anon key to INSERT scans. It needs no
-- permission to read/update scans; website polling uses authenticated Admin.
create policy "Bluetooth bridge can insert scan events"
on public.scan_events for insert to anon
with check (true);

-- Students may query only this narrow inventory view, not borrower names or
-- movement history. Admins use admin_tools for full tool records.
create or replace view public.student_tool_inventory
with (security_invoker = true)
as
select uid, tool_name, tool_code, status, availability_reason
from public.tools
where public.has_active_access();

create or replace view public.admin_tools
with (security_invoker = false)
as
select * from public.tools
where public.is_admin();

create or replace view public.dashboard_stats
with (security_invoker = false)
as
select
  (select count(*) from public.tools) as total_tools,
  (select count(*) from public.tools where status = 'Available') as available_tools,
  (select count(*) from public.tools where status = 'Not Available') as not_available_tools,
  (select count(*) from public.borrow_sessions where status = 'Active') as active_sessions,
  (select count(*) from public.borrow_sessions where status = 'Completed') as completed_sessions
where public.is_admin();

create or replace view public.current_not_available_tools
with (security_invoker = false)
as
select uid, tool_name, tool_code, status, availability_reason,
       current_borrower, borrowed_at, workshop
from public.tools
where status = 'Not Available' and public.is_admin()
order by borrowed_at desc;

create or replace view public.today_borrow_list
with (security_invoker = false)
as
select bh.created_at, bh.session_id, bh.borrower_name,
       t.tool_name, t.tool_code, bh.action
from public.borrow_history bh
join public.tools t on bh.tool_uid = t.uid
where bh.created_at::date = current_date and public.is_admin()
order by bh.created_at desc;

create or replace view public.today_dashboard_stats
with (security_invoker = false)
as
select
  (select count(*) from public.borrow_history
   where action = 'Borrowed' and created_at::date = current_date) as borrowed_today,
  (select count(*) from public.borrow_history
   where action = 'Returned' and created_at::date = current_date) as returned_today,
  (select count(*) from public.borrow_sessions
   where status = 'Active' and created_at::date = current_date) as active_sessions_today,
  (select count(*) from public.borrow_sessions
   where status = 'Completed' and created_at::date = current_date) as completed_sessions_today
where public.is_admin();

create or replace view public.tool_summary
with (security_invoker = false)
as
select tool_name,
       count(*) as total_quantity,
       count(*) filter (where status = 'Available') as available_quantity,
       count(*) filter (where status = 'Not Available') as not_available_quantity
from public.tools
where public.is_admin()
group by tool_name
order by tool_name;

-- The bridge continues to post heartbeats through scanner_status. This leaves
-- its existing scanner_status policies intact. Anonymous scan-event access is
-- limited to INSERT only.
revoke all on public.audit_logs, public.borrow_history, public.borrow_sessions,
  public.scan_events, public.tools, public.user_access
from public, anon;
grant insert on public.scan_events to anon;

-- Authenticated Admins may perform existing app workflows. Students have
-- read-only access to safe tool columns; row policies block all their writes.
revoke all on public.audit_logs, public.borrow_history, public.borrow_sessions,
  public.scan_events, public.tools from authenticated;
grant select, insert, update, delete on public.audit_logs, public.borrow_history,
  public.borrow_sessions, public.scan_events to authenticated;
grant insert, update, delete on public.tools to authenticated;
grant select (uid, tool_name, tool_code, status, availability_reason)
  on public.tools to authenticated;

revoke all on public.dashboard_stats, public.current_not_available_tools,
  public.today_borrow_list, public.today_dashboard_stats, public.tool_summary,
  public.admin_tools, public.student_tool_inventory from public, anon, authenticated;
grant select on public.dashboard_stats, public.current_not_available_tools,
  public.today_borrow_list, public.today_dashboard_stats, public.tool_summary,
  public.admin_tools, public.student_tool_inventory to authenticated;

commit;
