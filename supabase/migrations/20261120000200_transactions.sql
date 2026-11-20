-- RoboHaven backend migration. Run AFTER supabase/schema.sql, in the Supabase SQL Editor.
-- Business-critical writes live in these functions so they are atomic (row locks, one transaction).
-- They are callable ONLY by the NestJS API (service_role key), never by browsers.

-- Allow approving an older request after its requested date has passed (the API validates the date on create).
do $$ declare c text; begin
  for c in select conname from pg_constraint
    where conrelid='public.borrow_requests'::regclass and contype='c'
      and pg_get_constraintdef(oid) ilike '%requested_due_date%current_date%'
  loop execute format('alter table public.borrow_requests drop constraint %I', c); end loop;
end $$;

create or replace function public.club_pref(p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path=public as $$
  select coalesce((select (value->>p_key)::numeric from public.club_settings where key='preferences'), p_default)
$$;

-- Create a request + items + participants in one transaction.
create or replace function public.create_borrow_request(
  p_requester uuid, p_group_name text, p_is_group boolean, p_project text, p_competition date,
  p_purpose text, p_due date, p_items jsonb, p_participants jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_limit int; v_pending int; e jsonb; v_cap int;
begin
  v_limit := public.club_pref('requestLimit', 3)::int;
  select count(*) into v_pending from borrow_requests where requester_id=p_requester and status='pending';
  if v_pending >= v_limit then raise exception 'PENDING_LIMIT_REACHED: max % pending requests', v_limit; end if;
  if p_due < current_date then raise exception 'INVALID_DUE_DATE'; end if;
  if jsonb_array_length(p_items)=0 then raise exception 'INVALID_NO_ITEMS'; end if;

  insert into borrow_requests(requester_id,group_name,is_group_request,project_name,competition_date,purpose,requested_due_date)
  values(p_requester,p_group_name,p_is_group,p_project,p_competition,p_purpose,p_due) returning id into v_id;

  for e in select * from jsonb_array_elements(p_items) loop
    select case when p_is_group then group_cap else individual_cap end into v_cap
      from products where id=(e->>'product_id')::uuid and is_active;
    if v_cap is null then raise exception 'INVALID_PRODUCT: %', e->>'product_id'; end if;
    if (e->>'quantity')::int > v_cap then raise exception 'INVALID_QUANTITY: cap is % for this product', v_cap; end if;
    insert into request_items(request_id,product_id,quantity) values(v_id,(e->>'product_id')::uuid,(e->>'quantity')::int);
  end loop;

  insert into request_participants(request_id,member_id,is_leader) values(v_id,p_requester,true);
  for e in select * from jsonb_array_elements(p_participants) loop
    insert into request_participants(request_id,member_id,is_leader)
    values(v_id,(e#>>'{}')::uuid,false) on conflict do nothing;
  end loop;
  return v_id;
end $$;

-- Approve: lock request, allocate physical units (skip locked => no double allocation), open the loan.
create or replace function public.approve_request(p_request uuid, p_reviewer uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare r public.borrow_requests; it record; v_loan uuid; v_units uuid[];
begin
  select * into r from borrow_requests where id=p_request for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if r.status <> 'pending' then raise exception 'REQUEST_NOT_PENDING'; end if;

  insert into loans(request_id,borrower_id,issued_by,due_at)
  values(r.id,r.requester_id,p_reviewer,r.requested_due_date) returning id into v_loan;

  for it in select * from request_items where request_id=r.id loop
    select array_agg(id) into v_units from (
      select id from inventory_units where product_id=it.product_id and status='available'
      order by asset_tag limit it.quantity for update skip locked) s;
    if coalesce(array_length(v_units,1),0) < it.quantity then raise exception 'INSUFFICIENT_STOCK: product %', it.product_id; end if;
    insert into loan_items(loan_id,inventory_unit_id,issued_condition)
      select v_loan,u.id,u.condition from inventory_units u where u.id=any(v_units);
    update inventory_units set status='on_loan' where id=any(v_units);
    insert into inventory_movements(inventory_unit_id,movement_type,from_status,to_status,note,performed_by)
      select x,'issue','available','on_loan','Loan '||v_loan,p_reviewer from unnest(v_units) x;
  end loop;

  update borrow_requests set status='approved',reviewed_by=p_reviewer,reviewed_at=now(),review_note=p_note where id=r.id;
  insert into notifications(recipient_id,actor_id,title,body)
    values(r.requester_id,p_reviewer,'Request approved','Your request for "'||r.project_name||'" was approved. Due '||r.requested_due_date||'.');
  insert into audit_logs(actor_id,action,entity_type,entity_id,after_data)
    values(p_reviewer,'request.approved','borrow_request',r.id,jsonb_build_object('loan_id',v_loan));
  return v_loan;
end $$;

-- Return all (p_items null) or some items. p_items: [{"loan_item_id":uuid,"condition":"good","note":"..."}]
create or replace function public.return_loan(p_loan uuid, p_actor uuid, p_items jsonb default null)
returns public.loan_status language plpgsql security definer set search_path=public as $$
declare l public.loans; li record; v_cond public.item_condition; v_note text; v_open int;
        v_pts int; v_on_time boolean; v_grace int;
begin
  select * into l from loans where id=p_loan for update;
  if not found then raise exception 'LOAN_NOT_FOUND'; end if;
  if l.status='returned' then raise exception 'LOAN_ALREADY_RETURNED'; end if;

  for li in select * from loan_items where loan_id=p_loan and returned_at is null loop
    v_cond := li.issued_condition; v_note := null;
    if p_items is not null then
      select coalesce((e->>'condition')::item_condition, li.issued_condition), e->>'note'
        into v_cond, v_note from jsonb_array_elements(p_items) e where (e->>'loan_item_id')::uuid = li.id;
      if not found then continue; end if;
    end if;
    update loan_items set returned_at=now(), returned_condition=v_cond, return_note=v_note where id=li.id;
    update inventory_units set condition=v_cond,
      status = case v_cond when 'unusable' then 'retired' when 'damaged' then 'maintenance' when 'repairable' then 'maintenance' else 'available' end
      where id=li.inventory_unit_id;
    insert into inventory_movements(inventory_unit_id,movement_type,from_status,to_status,note,performed_by)
      values(li.inventory_unit_id,'return','on_loan',
        case v_cond when 'unusable' then 'retired' when 'damaged' then 'maintenance' when 'repairable' then 'maintenance' else 'available' end,
        'Loan '||p_loan,p_actor);
    if v_cond in ('damaged','unusable') then
      insert into maintenance_records(inventory_unit_id,reported_by,issue)
      values(li.inventory_unit_id,p_actor,coalesce(v_note,'Reported '||v_cond||' on return'));
    end if;
  end loop;

  select count(*) into v_open from loan_items where loan_id=p_loan and returned_at is null;
  if v_open > 0 then
    update loans set status='partially_returned' where id=p_loan;
    return 'partially_returned';
  end if;

  update loans set status='returned', returned_at=now() where id=p_loan;
  v_grace := public.club_pref('graceDays',1)::int;
  v_on_time := current_date <= l.due_at + v_grace;
  v_pts := (case when v_on_time then public.club_pref('onTimePoints',5) else -public.club_pref('latePenalty',5) end)::int;
  if v_pts <> 0 then
    insert into reputation_ledger(member_id,delta,reason,source_type,source_id,adjusted_by)
      values(l.borrower_id,v_pts,case when v_on_time then 'Returned on time' else 'Returned late' end,
             case when v_on_time then 'on_time_return' else 'late_return' end,l.id,p_actor);
    update profiles set reputation_score=reputation_score+v_pts, updated_at=now() where id=l.borrower_id;
  end if;
  -- Return events are recorded in audit logs, not member notifications.
  insert into audit_logs(actor_id,action,entity_type,entity_id,after_data)
    values(p_actor,'loan.returned','loan',l.id,jsonb_build_object('on_time',v_on_time,'points',v_pts));
  return 'returned';
end $$;

-- Flag overdue loans (called by the API cron and on demand). Returns number flagged.
create or replace function public.mark_overdue_loans() returns int
language plpgsql security definer set search_path=public as $$
declare n int;
begin
  with u as (update loans set status='overdue'
    where status in ('active','partially_returned') and due_at < current_date returning id)
  select count(*) into n from u;
  return n;
end $$;

create or replace function public.adjust_reputation(p_member uuid, p_delta int, p_reason text, p_admin uuid)
returns int language plpgsql security definer set search_path=public as $$
declare v_score int;
begin
  if p_delta = 0 then raise exception 'INVALID_DELTA'; end if;
  insert into reputation_ledger(member_id,delta,reason,source_type,adjusted_by)
    values(p_member,p_delta,p_reason,'admin_adjustment',p_admin);
  update profiles set reputation_score=reputation_score+p_delta, updated_at=now()
    where id=p_member returning reputation_score into v_score;
  if v_score is null then raise exception 'INVALID_MEMBER'; end if;
  insert into audit_logs(actor_id,action,entity_type,entity_id,after_data)
    values(p_admin,'reputation.adjusted','profile',p_member,jsonb_build_object('delta',p_delta,'reason',p_reason));
  return v_score;
end $$;

drop function if exists public.assess_donation(uuid,uuid,boolean,int);
create or replace function public.assess_donation(p_donation uuid, p_actor uuid, p_accept boolean, p_points int, p_note text default null)
returns public.donations language plpgsql security definer set search_path=public as $$
declare d public.donations;
begin
  select * into d from donations where id=p_donation for update;
  if not found then raise exception 'INVALID_DONATION'; end if;
  if d.status <> 'pending' then raise exception 'REQUEST_NOT_PENDING: donation already assessed'; end if;
  update donations set status=case when p_accept then 'accepted' else 'rejected' end,
    assessed_by=p_actor, assessed_at=now(), review_note=case when p_accept then null else p_note end, reputation_awarded=case when p_accept then p_points else 0 end
    where id=p_donation returning * into d;
  if p_accept and p_points > 0 then
    insert into reputation_ledger(member_id,delta,reason,source_type,source_id,adjusted_by)
      values(d.donor_id,p_points,initcap(d.contribution_type)||' accepted','donation',d.id,p_actor);
    update profiles set reputation_score=reputation_score+p_points, updated_at=now() where id=d.donor_id;
  end if;
  insert into notifications(recipient_id,actor_id,title,body)
    values(d.donor_id,p_actor,initcap(d.contribution_type)||' '||d.status,'Your '||d.contribution_type||' was '||d.status||case when not p_accept and p_note is not null then '. Reason: '||p_note else '.' end);
  insert into audit_logs(actor_id,action,entity_type,entity_id,after_data)
    values(p_actor,'donation.'||d.status,'donation',d.id,jsonb_build_object('points',d.reputation_awarded,'review_note',d.review_note));
  return d;
end $$;

-- Lock the functions down: only the API (service_role) may execute them.
do $$ declare f text; begin
  foreach f in array array[
    'club_pref(text,numeric)',
    'create_borrow_request(uuid,text,boolean,text,date,text,date,jsonb,jsonb)',
    'approve_request(uuid,uuid,text)','return_loan(uuid,uuid,jsonb)','mark_overdue_loans()',
    'adjust_reputation(uuid,int,text,uuid)','assess_donation(uuid,uuid,boolean,int,text)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
