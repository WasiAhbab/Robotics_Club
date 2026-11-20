-- Set owner_id to the verified Auth user UUID in your private SQL Editor session.
do $$
declare owner_id uuid := '00000000-0000-0000-0000-000000000000'; existing uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('robohaven.owner',0));
 if not exists(select 1 from auth.users where id=owner_id and email_confirmed_at is not null) then raise exception 'Verify the intended owner email first'; end if;
 select id into existing from public.profiles where role='super_admin';
 if existing=owner_id then return; end if;
 if existing is not null then raise exception 'An owner already exists'; end if;
 update public.profiles set role='super_admin' where id=owner_id and is_active and membership_status='active';
 if not found then raise exception 'Active profile required'; end if;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id) values(owner_id,'owner.provisioned','profile',owner_id);
end $$;
