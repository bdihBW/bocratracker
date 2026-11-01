-- BDIH Project Tracking Tool: invoices (change to scope requested November 2026)
-- Developers submit invoices for their own workstream; BDIH submits its own invoices.
-- BOCRA and BDIH see every invoice; a developer sees only its own organisation's invoices.
-- Invoices go to the BOCRA Project Lead, who (with administrators) changes the status (invoice.status).

create type invoice_status as enum ('Submitted', 'Under review', 'Queried', 'Approved for payment', 'Paid', 'Rejected');

create table invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null,
  organisation_id uuid not null references organisations,
  workstream_id uuid not null references workstreams,       -- developer workstream, or Shared for BDIH
  deliverable_id uuid references deliverables,
  description text not null,
  invoice_date date not null,
  amount_excl_vat numeric(14, 2) not null check (amount_excl_vat > 0),
  vat_amount numeric(14, 2) not null default 0 check (vat_amount >= 0),
  total_amount numeric(14, 2) generated always as (amount_excl_vat + vat_amount) stored,
  currency text not null default 'BWP',
  status invoice_status not null default 'Submitted',
  status_comment text,
  status_by uuid references profiles,
  status_at timestamptz,
  payment_reference text,
  paid_on date,
  submitted_by uuid not null references profiles default auth.uid(),
  submitted_at timestamptz not null default now(),
  unique (organisation_id, invoice_no)
);

create table invoice_status_history (
  id bigint generated always as identity primary key,
  invoice_id uuid not null references invoices on delete cascade,
  old_status invoice_status,
  new_status invoice_status not null,
  comment text,
  changed_by uuid references profiles default auth.uid(),
  changed_at timestamptz not null default now()
);

alter table documents drop constraint if exists documents_entity_type_check;
alter table documents add constraint documents_entity_type_check check (entity_type in ('library', 'bank', 'activity', 'submission',
  'meeting', 'risk', 'issue', 'change_request', 'weekly_report', 'progress_report', 'invoice'));

alter table invoices enable row level security;
alter table invoices force row level security;
alter table invoice_status_history enable row level security;
alter table invoice_status_history force row level security;

create policy inv_read on invoices for select to authenticated using (is_oversight() or organisation_id = my_org());
create policy invh_read on invoice_status_history for select to authenticated using (
  exists (select 1 from invoices i where i.id = invoice_id and (is_oversight() or i.organisation_id = my_org())));
revoke insert, update, delete on invoices, invoice_status_history from authenticated;
grant select on invoices, invoice_status_history to authenticated;

create trigger invoices_audit after insert or update or delete on invoices for each row execute function trg_audit();

-- Submit (developer lead or delegated member for their workstream; BDIH Project Leader or admin for BDIH)
create or replace function public.submit_invoice(p_invoice_no text, p_description text, p_invoice_date date,
  p_amount numeric, p_vat numeric, p_deliverable uuid default null, p_document_ids uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare me profiles%rowtype; t org_type; ws uuid; iid uuid;
begin
  select * into me from profiles where id = auth.uid() and active;
  t := org_type_of(me.id);
  if not has_perm('invoice.submit') then
    raise exception 'Only a Developer Lead or the BDIH Project Leader submits invoices.';
  elsif t = 'Developer' then
    select workstream_id into ws from user_workstreams where user_id = me.id limit 1;
  elsif t = 'Project Manager' then
    ws := shared_workstream();
  else
    raise exception 'Only a Developer Lead or the BDIH Project Leader submits invoices.';
  end if;
  if p_deliverable is not null and not exists (select 1 from deliverables where id = p_deliverable and workstream_id = ws) then
    raise exception 'Link the invoice to a deliverable in your own workstream.';
  end if;
  insert into invoices (invoice_no, organisation_id, workstream_id, deliverable_id, description, invoice_date, amount_excl_vat, vat_amount)
  values (trim(p_invoice_no), me.organisation_id, ws, p_deliverable, p_description, p_invoice_date, p_amount, coalesce(p_vat, 0))
  returning id into iid;
  insert into invoice_status_history (invoice_id, old_status, new_status, comment) values (iid, null, 'Submitted', 'Invoice submitted');
  -- Invoice files are uploaded first as documents with entity_type 'invoice'; attach them here
  update documents set entity_type = 'invoice', entity_id = iid
  where id = any (p_document_ids) and workstream_id = ws and created_by = auth.uid();
  perform notify_users(users_with_role('BOCRA_REP') || users_with_role('BDIH_LEAD'),
    'Invoice submitted', 'Invoice ' || p_invoice_no || ' submitted by ' || (select name from organisations where id = me.organisation_id),
    null, false, 'invoice', iid, '/invoices', 'Invoices');
  return iid;
end $$;

-- Status changes by BOCRA (FR: invoices); a comment is required for Queried and Rejected
create or replace function public.set_invoice_status(p_invoice uuid, p_status invoice_status, p_comment text default null,
  p_payment_reference text default null, p_paid_on date default null)
returns void language plpgsql security definer set search_path = public as $$
declare i invoices%rowtype;
begin
  if not has_perm('invoice.status') then raise exception 'Only the BOCRA Project Lead updates invoice status.'; end if;
  select * into i from invoices where id = p_invoice for update;
  if not found then raise exception 'Invoice not found.'; end if;
  if i.status in ('Paid', 'Rejected') then raise exception 'This invoice is closed.'; end if;
  if p_status in ('Queried', 'Rejected') and coalesce(trim(p_comment), '') = '' then raise exception 'Give a reason for %.', p_status; end if;
  if p_status = 'Paid' and (p_paid_on is null or coalesce(trim(p_payment_reference), '') = '') then
    raise exception 'Record the payment date and reference.';
  end if;
  update invoices set status = p_status, status_comment = p_comment, status_by = auth.uid(), status_at = now(),
    payment_reference = coalesce(p_payment_reference, payment_reference), paid_on = coalesce(p_paid_on, paid_on)
  where id = i.id;
  insert into invoice_status_history (invoice_id, old_status, new_status, comment) values (i.id, i.status, p_status, p_comment);
  perform notify_users(array(select id from profiles where active and organisation_id = i.organisation_id
                              and roles_of(id) && array['DEV_LEAD', 'BDIH_LEAD', 'ADMIN']::app_role[]) || array[i.submitted_by] || users_with_role('BDIH_LEAD'),
    'Invoice ' || lower(p_status::text), 'Invoice ' || i.invoice_no || ': ' || p_status::text, null, false, 'invoice', i.id, '/invoices', 'Invoices');
end $$;

-- Resubmit a queried invoice with corrections
create or replace function public.resubmit_invoice(p_invoice uuid, p_description text, p_amount numeric, p_vat numeric, p_comment text)
returns void language plpgsql security definer set search_path = public as $$
declare i invoices%rowtype;
begin
  select * into i from invoices where id = p_invoice for update;
  if not found or i.organisation_id <> my_org() then raise exception 'Invoice not found.'; end if;
  if i.status <> 'Queried' then raise exception 'Only queried invoices can be resubmitted.'; end if;
  update invoices set description = p_description, amount_excl_vat = p_amount, vat_amount = coalesce(p_vat, 0), status = 'Submitted',
    status_comment = p_comment, status_by = auth.uid(), status_at = now() where id = i.id;
  insert into invoice_status_history (invoice_id, old_status, new_status, comment) values (i.id, i.status, 'Submitted', p_comment);
  perform notify_users(users_with_role('BOCRA_REP'),
    'Invoice resubmitted', 'Invoice ' || i.invoice_no || ' resubmitted', null, false, 'invoice', i.id, '/invoices', 'Invoices');
end $$;

-- Invoice summary for BOCRA and BDIH; developers see only their own organisation's rows
create or replace view public.v_invoices with (security_invoker = true) as
select i.*, o.name as organisation, w.name as workstream, d.ref as deliverable_ref, p.full_name as submitted_by_name,
       sp.full_name as status_by_name
from invoices i
join organisations o on o.id = i.organisation_id
join workstreams w on w.id = i.workstream_id
left join deliverables d on d.id = i.deliverable_id
left join profiles p on p.id = i.submitted_by
left join profiles sp on sp.id = i.status_by;

grant select on v_invoices to authenticated;
grant execute on function submit_invoice(text, text, date, numeric, numeric, uuid, uuid[]),
  set_invoice_status(uuid, invoice_status, text, text, date), resubmit_invoice(uuid, text, numeric, numeric, text) to authenticated;
alter publication supabase_realtime add table invoices;
