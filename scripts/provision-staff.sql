-- In the Supabase SQL Editor, enter the confirmed user's UUID and intended role.
do $$
declare
 target_id uuid := '00000000-0000-0000-0000-000000000000';
 staff_role public.club_role := null;
 previous_role public.club_role;
begin
 if staff_role is null or staff_role not in ('admin','moderator','secretary') then
   raise exception 'Choose admin, moderator or secretary';
 end if;
 select p.role into previous_role from public.profiles p join auth.users u on u.id=p.id
 where p.id=target_id and u.email_confirmed_at is not null and p.is_active and p.membership_status='active' for update of p;
 if not found then raise exception 'A verified, active member is required'; end if;
 if previous_role=staff_role then return; end if;
 update public.profiles set role=staff_role where id=target_id;
 insert into public.audit_logs(action,entity_type,entity_id,before_data,after_data)
 values('staff.provisioned','profile',target_id,jsonb_build_object('role',previous_role),
        jsonb_build_object('role',staff_role,'database_user',session_user));
end $$;
