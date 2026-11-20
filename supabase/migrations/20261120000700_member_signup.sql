-- Public signup creates a member even if an earlier installation closed registration.
drop function public.set_registration(boolean);
drop view public.workspace_registration;
drop function public.invite_member(text,text,text,text);
delete from public.club_settings where key='registration_open';

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into profiles(id,full_name,role) values(new.id,
   coalesce(nullif(left(trim(new.raw_user_meta_data->>'full_name'),200),''),split_part(new.email,'@',1)), 'member');
 insert into audit_logs(actor_id,action,entity_type,entity_id) values(new.id,'member.registered','profile',new.id);
 return new;
end $$;

create or replace function public.current_role() returns public.club_role
language sql stable security definer set search_path=public,pg_temp as $$
 select p.role from profiles p where p.id=auth.uid() and p.is_active and
 (p.membership_status='active' or p.membership_status='suspended' and p.suspended_until<=now())
$$;

-- Also protect against older deployed API versions using a service-role session.
create function club_private.database_only_roles() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if current_setting('role') in ('anon','authenticated','service_role') and
    (tg_op='INSERT' and new.role<>'member' or tg_op='UPDATE' and new.role is distinct from old.role) then
   raise exception 'Staff roles must be assigned in the database' using errcode='42501';
 end if;
 return new;
end $$;
create trigger database_only_roles before insert or update of role on public.profiles
for each row execute function club_private.database_only_roles();

create or replace function public.manage_member(target uuid, action text, reason text default null, points int default null, days int default null, new_role public.club_role default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_role public.club_role; m profiles;
begin
 actor_role:=club_private.require_role('{super_admin,admin,moderator}');
 select * into strict m from profiles where id=target for update;
 if target=auth.uid() or m.role='super_admin' or (m.role='admin' and actor_role<>'super_admin') then raise exception 'Protected member'; end if;
 case action
 when 'rep' then
  if points is null or points=0 or abs(points)>500 then raise exception 'Invalid points'; end if;
  perform adjust_reputation(target,points,club_private.required(reason),auth.uid()); return;
 when 'role' then
  raise exception 'Staff roles must be assigned in the database' using errcode='42501';
 when 'achievement' then
  insert into member_achievements(member_id,title,is_verified,verified_by) values(target,club_private.required(reason),true,auth.uid());
 when 'restore','kick','suspend' then
  if actor_role='moderator' then raise exception 'Permission denied'; end if;
  if action='suspend' and (days is null or days not between 1 and 365) then raise exception 'Invalid suspension duration'; end if;
  if action<>'restore' then reason:=club_private.required(reason); end if;
  update profiles set is_active=action<>'kick',membership_status=case action when 'kick' then 'banned' when 'suspend' then 'suspended' else 'active' end,
   suspended_until=case when action='suspend' then now()+make_interval(days=>days) end,status_reason=case when action<>'restore' then reason end where id=target;
 else raise exception 'Unknown member action';
 end case;
 if action in ('restore','kick','suspend') then insert into notifications(recipient_id,actor_id,title,body) values(target,auth.uid(),'Membership updated',coalesce(reason,'Membership restored')); end if;
 perform club_private.audit('member.'||action,'profile',target,jsonb_build_object('reason',reason,'days',days,'role',new_role,'previous_role',m.role,'previous_status',m.membership_status));
end $$;
