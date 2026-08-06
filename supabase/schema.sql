-- Unfall- und Maßnahmenmanagement: produktives, organisationsbezogenes Datenmodell
-- Voraussetzung: 001_core_and_kataster.sql aus gefahrstoffkataster-online wurde
-- im selben Supabase-Projekt ausgeführt.

begin;

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_number text not null,
  status text not null default 'offen' check(status in ('offen','in_bearbeitung','abgeschlossen')),
  incident_date date,
  department text,
  affected_person text,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,case_number),
  unique(id,organization_id)
);

create index if not exists incidents_org_date_idx
  on public.incidents(organization_id,incident_date desc);
create index if not exists incidents_org_status_idx
  on public.incidents(organization_id,status);

create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  incident_id uuid,
  title text not null,
  cause text,
  hierarchy text check(hierarchy in ('Substitution','Technisch','Organisatorisch','Personenbezogen')),
  responsible_name text,
  responsible_email text not null,
  manager_email text,
  due_date date,
  extended_due_date date,
  extension_reason text,
  extension_requested_at timestamptz,
  escalation_state text not null default 'none' check(escalation_state in ('none','extension_requested','manager_notified')),
  escalated_at timestamptz,
  status text not null default 'offen' check(status in ('offen','erledigt')),
  completed_at timestamptz,
  effectiveness_due_date date,
  effectiveness_status text not null default 'offen' check(effectiveness_status in ('offen','wirksam','teilweise_wirksam','nicht_wirksam')),
  last_weekly_reminder_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organization_id),
  constraint actions_incident_same_org_fk
    foreign key(incident_id,organization_id)
    references public.incidents(id,organization_id)
    on delete cascade
);

create index if not exists actions_org_status_due_idx
  on public.actions(organization_id,status,due_date);
create index if not exists actions_org_responsible_idx
  on public.actions(organization_id,responsible_email);
create index if not exists actions_org_incident_idx
  on public.actions(organization_id,incident_id);

create table if not exists public.action_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  incident_id uuid,
  action_id uuid,
  event_type text not null,
  event_text text,
  old_value jsonb,
  new_value jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint history_incident_same_org_fk
    foreign key(incident_id,organization_id)
    references public.incidents(id,organization_id)
    on delete cascade,
  constraint history_action_same_org_fk
    foreign key(action_id,organization_id)
    references public.actions(id,organization_id)
    on delete cascade
);

create table if not exists public.email_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  message_type text not null,
  recipient text not null,
  cc text,
  action_id uuid,
  provider_message_id text,
  delivery_status text not null,
  error_message text,
  created_at timestamptz not null default now(),
  constraint email_action_same_org_fk
    foreign key(action_id,organization_id)
    references public.actions(id,organization_id)
    on delete set null
);

create table if not exists public.app_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key(organization_id,key)
);

create or replace function public.unfall_set_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin
  new.updated_at=now();
  new.updated_by=auth.uid();
  return new;
end; $$;

drop trigger if exists incidents_set_updated_at on public.incidents;
create trigger incidents_set_updated_at before update on public.incidents
for each row execute function public.unfall_set_updated_at();

drop trigger if exists actions_set_updated_at on public.actions;
create trigger actions_set_updated_at before update on public.actions
for each row execute function public.unfall_set_updated_at();

create or replace function public.log_action_change()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    insert into public.action_history(
      organization_id,incident_id,action_id,event_type,event_text,new_value,created_by
    ) values(
      new.organization_id,new.incident_id,new.id,'created','Maßnahme angelegt',to_jsonb(new),auth.uid()
    );
    return new;
  end if;

  if old.status is distinct from new.status then
    insert into public.action_history(
      organization_id,incident_id,action_id,event_type,event_text,old_value,new_value,created_by
    ) values(
      new.organization_id,new.incident_id,new.id,'status_changed','Status geändert',
      jsonb_build_object('status',old.status),jsonb_build_object('status',new.status),auth.uid()
    );
  end if;

  if old.due_date is distinct from new.due_date
     or old.extended_due_date is distinct from new.extended_due_date then
    insert into public.action_history(
      organization_id,incident_id,action_id,event_type,event_text,old_value,new_value,created_by
    ) values(
      new.organization_id,new.incident_id,new.id,'deadline_changed','Frist geändert',
      jsonb_build_object('due_date',old.due_date,'extended_due_date',old.extended_due_date),
      jsonb_build_object('due_date',new.due_date,'extended_due_date',new.extended_due_date),auth.uid()
    );
  end if;

  if old.escalation_state is distinct from new.escalation_state then
    insert into public.action_history(
      organization_id,incident_id,action_id,event_type,event_text,old_value,new_value,created_by
    ) values(
      new.organization_id,new.incident_id,new.id,'escalation_changed','Eskalationsstatus geändert',
      jsonb_build_object('escalation_state',old.escalation_state),
      jsonb_build_object('escalation_state',new.escalation_state),auth.uid()
    );
  end if;
  return new;
end; $$;

drop trigger if exists actions_audit_trigger on public.actions;
create trigger actions_audit_trigger after insert or update on public.actions
for each row execute function public.log_action_change();

alter table public.incidents enable row level security;
alter table public.actions enable row level security;
alter table public.action_history enable row level security;
alter table public.email_logs enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists incidents_member_read on public.incidents;
create policy incidents_member_read on public.incidents for select to authenticated
using(public.is_org_member(organization_id));
drop policy if exists incidents_member_insert on public.incidents;
create policy incidents_member_insert on public.incidents for insert to authenticated
with check(public.is_org_member(organization_id) and created_by=auth.uid());
drop policy if exists incidents_editor_update on public.incidents;
create policy incidents_editor_update on public.incidents for update to authenticated
using(created_by=auth.uid() or public.has_org_role(organization_id,array['owner','admin','ersteller','pruefer']))
with check(public.is_org_member(organization_id));
drop policy if exists incidents_admin_delete on public.incidents;
create policy incidents_admin_delete on public.incidents for delete to authenticated
using(public.has_org_role(organization_id,array['owner','admin']));

drop policy if exists actions_member_read on public.actions;
create policy actions_member_read on public.actions for select to authenticated
using(public.is_org_member(organization_id));
drop policy if exists actions_editor_insert on public.actions;
create policy actions_editor_insert on public.actions for insert to authenticated
with check(
  created_by=auth.uid()
  and public.has_org_role(organization_id,array['owner','admin','ersteller','pruefer','freigeber'])
);
drop policy if exists actions_editor_update on public.actions;
create policy actions_editor_update on public.actions for update to authenticated
using(created_by=auth.uid() or public.has_org_role(organization_id,array['owner','admin','ersteller','pruefer','freigeber']))
with check(public.is_org_member(organization_id));
drop policy if exists actions_admin_delete on public.actions;
create policy actions_admin_delete on public.actions for delete to authenticated
using(public.has_org_role(organization_id,array['owner','admin']));

drop policy if exists history_member_read on public.action_history;
create policy history_member_read on public.action_history for select to authenticated
using(public.is_org_member(organization_id));

drop policy if exists email_logs_admin_read on public.email_logs;
create policy email_logs_admin_read on public.email_logs for select to authenticated
using(public.has_org_role(organization_id,array['owner','admin']));

drop policy if exists settings_member_read on public.app_settings;
create policy settings_member_read on public.app_settings for select to authenticated
using(public.is_org_member(organization_id));
drop policy if exists settings_admin_manage on public.app_settings;
create policy settings_admin_manage on public.app_settings for all to authenticated
using(public.has_org_role(organization_id,array['owner','admin']))
with check(public.has_org_role(organization_id,array['owner','admin']));

revoke all on public.incidents,public.actions,public.action_history,public.email_logs,public.app_settings from anon;
grant select,insert,update,delete on public.incidents to authenticated;
grant select,insert,update,delete on public.actions to authenticated;
grant select on public.action_history to authenticated;
grant select on public.email_logs to authenticated;
grant select,insert,update,delete on public.app_settings to authenticated;

create or replace view public.open_action_reminders
with (security_invoker=false) as
select
  a.*,
  coalesce(a.extended_due_date,a.due_date) as effective_due_date,
  (coalesce(a.extended_due_date,a.due_date)<current_date) as is_overdue,
  i.case_number,
  i.department
from public.actions a
left join public.incidents i
  on i.id=a.incident_id and i.organization_id=a.organization_id
where a.status='offen';

revoke all on public.open_action_reminders from anon,authenticated;
grant select on public.open_action_reminders to service_role;

commit;
