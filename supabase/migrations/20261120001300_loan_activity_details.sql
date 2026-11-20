-- Refresh the read-only projection without modifying historical audit records.
grant robohaven_view_reader to current_user;
grant create on schema robohaven_reads to robohaven_view_reader;
create or replace view robohaven_reads.workspace_activity with (security_barrier=true) as
select a.id,
  case a.action when 'request.approved' then 'Loan approved' when 'loan.returned' then 'Loan returned'
    when 'loan.lost' then 'Non-return recorded' when 'request.submitted' then 'Borrowing requested'
    when 'request.rejected' then 'Request rejected' else a.action end as title,
  case when a.entity_type in ('loan','borrow_request') then
    concat_ws(' · ', coalesce(borrower.full_name, 'Member unavailable'),
      coalesce(items.description, 'Equipment unavailable'), nullif(a.after_data->>'reason',''))
    else concat_ws(' · ',a.entity_type,a.entity_id::text,nullif(a.after_data,'{}')::text) end as detail,
  'blue'::text as kind,a.created_at as at,actor.full_name as actor
from public.audit_logs a
left join public.profiles actor on actor.id=a.actor_id
left join public.loans l on a.entity_type='loan' and l.id=a.entity_id
left join public.borrow_requests r on r.id=case when a.entity_type='borrow_request' then a.entity_id else l.request_id end
left join public.profiles borrower on borrower.id=coalesce(l.borrower_id,r.requester_id)
left join lateral (
  select string_agg(i.quantity::text || ' × ' || p.name, ', ' order by p.name,p.id) as description
  from public.request_items i join public.products p on p.id=i.product_id where i.request_id=r.id
) items on true
where public.current_role() in ('super_admin','admin','moderator');
revoke create on schema robohaven_reads from robohaven_view_reader;
revoke robohaven_view_reader from current_user;
