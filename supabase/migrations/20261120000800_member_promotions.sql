create or replace function club_private.database_only_roles() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
 if current_user in ('anon','authenticated','service_role') and
    (tg_op='INSERT' and new.role<>'member' or tg_op='UPDATE' and new.role is distinct from old.role) then
   raise exception 'Staff roles must be assigned in the database or by an authorized promotion' using errcode='42501';
 end if;
 return new;
end $$;

create function public.promote_member(target uuid, staff_role public.club_role) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform club_private.require_role('{super_admin,admin}');
 if staff_role is null or staff_role not in ('admin','moderator','secretary') then raise exception 'Choose Admin, Moderator or Secretary'; end if;
 update profiles set role=staff_role,updated_at=now()
 where id=target and role='member' and is_active and membership_status='active';
 if not found then raise exception 'An active Member is required for promotion'; end if;
 perform club_private.audit('member.promoted','profile',target,jsonb_build_object('previous_role','member','role',staff_role));
 insert into notifications(recipient_id,actor_id,title,body) values(target,auth.uid(),'Role updated','Your club role is now '||initcap(staff_role::text)||'.');
end $$;
revoke all on function public.promote_member(uuid,public.club_role) from public,anon,authenticated;
grant execute on function public.promote_member(uuid,public.club_role) to authenticated;

-- Publish only the member's own change signal. Profile details stay private.
create table public.role_updates(id uuid primary key references public.profiles(id) on delete cascade, changed_at timestamptz not null);
alter table public.role_updates enable row level security;
revoke all on public.role_updates from public,anon,authenticated;
grant select on public.role_updates to authenticated;
create policy own_role_updates on public.role_updates for select to authenticated using(id=auth.uid());
create function club_private.signal_role_update() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into role_updates values(new.id,clock_timestamp()) on conflict(id) do update set changed_at=excluded.changed_at;
 return new;
end $$;
create trigger signal_role_update after update of role on public.profiles for each row when(old.role is distinct from new.role) execute function club_private.signal_role_update();
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.role_updates;
 end if;
end $$;
