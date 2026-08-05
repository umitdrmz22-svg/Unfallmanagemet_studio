create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'user' check (role in ('admin','ehs','management','hr','supervisor','user')),
  department text,
  manager_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  case_number text not null unique,
  status text not null default 'offen' check (status in ('offen','in_bearbeitung','abgeschlossen')),
  incident_date date,
  department text,
  affected_person text,
  data jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists incidents_incident_date_idx on public.incidents(incident_date desc);
create index if not exists incidents_status_idx on public.incidents(status);

create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid references public.incidents(id) on delete cascade,
  title text not null,
  cause text,
  hierarchy text check (hierarchy in ('Substitution','Technisch','Organisatorisch','Personenbezogen')),
  responsible_name text,
  responsible_email text not null,
  manager_email text,
  due_date date,
  extended_due_date date,
  extension_reason text,
  extension_requested_at timestamptz,
  escalation_state text not null default 'none' check (escalation_state in ('none','extension_requested','manager_notified')),
  escalated_at timestamptz,
  status text not null default 'offen' check (status in ('offen','erledigt')),
  completed_at timestamptz,
  effectiveness_due_date date,
  effectiveness_status text not null default 'offen' check (effectiveness_status in ('offen','wirksam','teilweise_wirksam','nicht_wirksam')),
  last_weekly_reminder_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists actions_status_due_idx on public.actions(status, due_date);
create index if not exists actions_responsible_email_idx on public.actions(responsible_email);
create index if not exists actions_incident_id_idx on public.actions(incident_id);

create table if not exists public.action_history (
  id bigint generated always as identity primary key,
  incident_id uuid references public.incidents(id) on delete cascade,
  action_id uuid references public.actions(id) on delete cascade,
  event_type text not null,
  event_text text,
  old_value jsonb,
  new_value jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.email_logs (
  id bigint generated always as identity primary key,
  message_type text not null,
  recipient text not null,
  cc text,
  action_id uuid references public.actions(id) on delete set null,
  provider_message_id text,
  delivery_status text not null,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings(key, value)
values ('weekly_reminder', '{"enabled": true, "weekday": 1, "include_all_open": true}'::jsonb)
on conflict (key) do nothing;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists incidents_set_updated_at on public.incidents;
create trigger incidents_set_updated_at before update on public.incidents
for each row execute function public.set_updated_at();

drop trigger if exists actions_set_updated_at on public.actions;
create trigger actions_set_updated_at before update on public.actions
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'user')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'user');
$$;

create or replace function public.log_action_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.action_history(incident_id, action_id, event_type, event_text, new_value, created_by)
    values (new.incident_id, new.id, 'created', 'Maßnahme angelegt', to_jsonb(new), auth.uid());
    return new;
  end if;

  if old.status is distinct from new.status then
    insert into public.action_history(incident_id, action_id, event_type, event_text, old_value, new_value, created_by)
    values (new.incident_id, new.id, 'status_changed', 'Status geändert', jsonb_build_object('status', old.status), jsonb_build_object('status', new.status), auth.uid());
  end if;

  if old.due_date is distinct from new.due_date or old.extended_due_date is distinct from new.extended_due_date then
    insert into public.action_history(incident_id, action_id, event_type, event_text, old_value, new_value, created_by)
    values (new.incident_id, new.id, 'deadline_changed', 'Frist geändert', jsonb_build_object('due_date', old.due_date, 'extended_due_date', old.extended_due_date), jsonb_build_object('due_date', new.due_date, 'extended_due_date', new.extended_due_date), auth.uid());
  end if;

  if old.escalation_state is distinct from new.escalation_state then
    insert into public.action_history(incident_id, action_id, event_type, event_text, old_value, new_value, created_by)
    values (new.incident_id, new.id, 'escalation_changed', 'Eskalationsstatus geändert', jsonb_build_object('escalation_state', old.escalation_state), jsonb_build_object('escalation_state', new.escalation_state), auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists actions_audit_trigger on public.actions;
create trigger actions_audit_trigger after insert or update on public.actions
for each row execute function public.log_action_change();

alter table public.profiles enable row level security;
alter table public.incidents enable row level security;
alter table public.actions enable row level security;
alter table public.action_history enable row level security;
alter table public.email_logs enable row level security;
alter table public.app_settings enable row level security;

create policy "profile own read" on public.profiles for select to authenticated
using (id = auth.uid() or public.current_user_role() in ('admin','ehs','management','hr'));
create policy "profile admin update" on public.profiles for update to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

create policy "incidents authenticated read" on public.incidents for select to authenticated
using (public.current_user_role() in ('admin','ehs','management','hr','supervisor','user'));
create policy "incidents authenticated insert" on public.incidents for insert to authenticated
with check (created_by = auth.uid());
create policy "incidents qualified update" on public.incidents for update to authenticated
using (created_by = auth.uid() or public.current_user_role() in ('admin','ehs','management','supervisor'))
with check (created_by = auth.uid() or public.current_user_role() in ('admin','ehs','management','supervisor'));
create policy "incidents admin delete" on public.incidents for delete to authenticated
using (public.current_user_role() in ('admin','ehs'));

create policy "actions authenticated read" on public.actions for select to authenticated
using (public.current_user_role() in ('admin','ehs','management','hr','supervisor','user'));
create policy "actions authenticated insert" on public.actions for insert to authenticated
with check (created_by = auth.uid());
create policy "actions qualified update" on public.actions for update to authenticated
using (public.current_user_role() in ('admin','ehs','management','supervisor','user'))
with check (public.current_user_role() in ('admin','ehs','management','supervisor','user'));
create policy "actions admin delete" on public.actions for delete to authenticated
using (public.current_user_role() in ('admin','ehs'));

create policy "history authenticated read" on public.action_history for select to authenticated
using (public.current_user_role() in ('admin','ehs','management','hr','supervisor'));
create policy "email logs privileged read" on public.email_logs for select to authenticated
using (public.current_user_role() in ('admin','ehs'));
create policy "settings privileged read" on public.app_settings for select to authenticated
using (public.current_user_role() in ('admin','ehs','management'));
create policy "settings admin update" on public.app_settings for update to authenticated
using (public.current_user_role() in ('admin','ehs'))
with check (public.current_user_role() in ('admin','ehs'));

create or replace view public.open_action_reminders
with (security_invoker = false)
as
select
  a.*,
  coalesce(a.extended_due_date, a.due_date) as effective_due_date,
  (coalesce(a.extended_due_date, a.due_date) < current_date) as is_overdue,
  i.case_number,
  i.department
from public.actions a
left join public.incidents i on i.id = a.incident_id
where a.status = 'offen';

comment on view public.open_action_reminders is 'Service-Role-Ansicht für den wöchentlichen Erinnerungsversand.';
revoke all on public.open_action_reminders from anon, authenticated;
grant select on public.open_action_reminders to service_role;
