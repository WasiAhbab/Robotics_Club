-- RoboHaven follow-up migration: preserve the acting user on notifications.
alter table public.notifications
  add column if not exists actor_id uuid references public.profiles(id);

create index if not exists notifications_recipient_created
  on public.notifications(recipient_id, created_at desc);

-- Backfill actor IDs for new request and contribution notifications through the
-- updated backend.sql functions / NestJS AuditService. Existing historical rows
-- remain nullable because their original actor may not be recoverable.

alter table public.donations add column if not exists review_note text;

-- Replace the assessment RPC with a reason-aware version for rejections.
drop function if exists public.assess_donation(uuid,uuid,boolean,int);
create or replace function public.assess_donation(p_donation uuid, p_actor uuid, p_accept boolean, p_points int, p_note text default null)
returns public.donations language plpgsql security definer set search_path=public as $$
declare d public.donations;
begin
  if not p_accept and nullif(trim(p_note), '') is null then raise exception 'REJECTION_REASON_REQUIRED'; end if;
  select * into d from donations where id=p_donation for update;
  if not found then raise exception 'INVALID_DONATION'; end if;
  if d.status <> 'pending' then raise exception 'REQUEST_NOT_PENDING: donation already assessed'; end if;
  update donations set status=case when p_accept then 'accepted' else 'rejected' end,
    assessed_by=p_actor, assessed_at=now(), review_note=case when p_accept then null else trim(p_note) end,
    reputation_awarded=case when p_accept then p_points else 0 end
    where id=p_donation returning * into d;
  if p_accept and p_points > 0 then
    insert into reputation_ledger(member_id,delta,reason,source_type,source_id,adjusted_by)
      values(d.donor_id,p_points,initcap(d.contribution_type)||' accepted','donation',d.id,p_actor);
    update profiles set reputation_score=reputation_score+p_points, updated_at=now() where id=d.donor_id;
  end if;
  insert into notifications(recipient_id,actor_id,title,body)
    values(d.donor_id,p_actor,initcap(d.contribution_type)||' '||d.status,'Your '||d.contribution_type||' was '||d.status||case when not p_accept then '. Reason: '||trim(p_note) else '.' end);
  insert into audit_logs(actor_id,action,entity_type,entity_id,after_data)
    values(p_actor,'donation.'||d.status,'donation',d.id,jsonb_build_object('points',d.reputation_awarded,'review_note',d.review_note));
  return d;
end $$;

revoke all on function public.assess_donation(uuid,uuid,boolean,int,text) from public, anon, authenticated;
grant execute on function public.assess_donation(uuid,uuid,boolean,int,text) to service_role;
