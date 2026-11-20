create table club_private.member_invitations (
 email text primary key, name text not null, team text, grade text,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create function public.invite_member(email text, name text, team text default null, grade text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform club_private.require_role('{super_admin,admin,moderator}');
 email:=lower(trim(email));
 if email is null or length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;
 if exists(select 1 from auth.users u where lower(u.email)=invite_member.email) then raise exception 'Account already registered'; end if;
 insert into club_private.member_invitations values(email,club_private.required(name),left(team,200),left(grade,200),auth.uid(),now());
 perform club_private.audit('member.invited','profile',null,jsonb_build_object('email',email));
end $$;
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare invitation club_private.member_invitations;
begin
 delete from club_private.member_invitations where email=lower(new.email) returning * into invitation;
 if invitation.email is null and exists(select 1 from club_settings where key='registration_open' and value='false'::jsonb) then raise exception 'Registration requires a club invitation'; end if;
 insert into profiles(id,full_name,team_name,academic_level) values(new.id,coalesce(invitation.name,nullif(left(trim(new.raw_user_meta_data->>'full_name'),200),''),split_part(new.email,'@',1)),invitation.team,invitation.grade);
 insert into audit_logs(actor_id,action,entity_type,entity_id) values(new.id,'member.registered','profile',new.id);
 return new;
end $$;
create function public.set_registration(open boolean) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform club_private.require_role('{super_admin}');
 insert into club_settings(key,value,updated_by) values('registration_open',to_jsonb(open),auth.uid())
 on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now();
 perform club_private.audit('registration.changed','club_settings',null,jsonb_build_object('open',open));
end $$;
create view public.workspace_registration with(security_barrier=true) as select coalesce((select value::boolean from public.club_settings where key='registration_open'),true) as open where public.current_role()='super_admin';
revoke all on public.workspace_registration from public,anon,authenticated;
grant select on public.workspace_registration to authenticated;
revoke all on function public.invite_member(text,text,text,text), public.set_registration(boolean) from public,anon,authenticated;
grant execute on function public.invite_member(text,text,text,text), public.set_registration(boolean) to authenticated;

-- Until the verified owner is provisioned, signup works and workspace access stays closed.
create or replace function public.current_role() returns public.club_role language sql stable security definer set search_path=public,pg_temp as $$
 select p.role from profiles p where p.id=auth.uid() and p.is_active and
 (p.membership_status='active' or p.membership_status='suspended' and p.suspended_until<=now())
 and exists(select 1 from profiles where role='super_admin' and is_active and membership_status='active')
$$;
