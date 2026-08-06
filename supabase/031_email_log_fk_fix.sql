-- Email-Protokolle sollen bei gelöschten Maßnahmen erhalten bleiben.
-- Nur action_id wird dabei auf NULL gesetzt; organization_id bleibt für die
-- Mandantentrennung und Nachvollziehbarkeit bestehen.

begin;

alter table if exists public.email_logs
  drop constraint if exists email_action_same_org_fk;

alter table if exists public.email_logs
  drop constraint if exists email_logs_action_id_fkey;

alter table if exists public.email_logs
  add constraint email_logs_action_id_fkey
  foreign key(action_id) references public.actions(id) on delete set null;

commit;
