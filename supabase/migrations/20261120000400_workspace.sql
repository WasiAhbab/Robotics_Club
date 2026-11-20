create schema if not exists club_private;
revoke all on schema club_private from public, anon, authenticated;
alter table public.products add column if not exists views text[] not null default '{}';
alter table public.donations add column if not exists image_path text;
create index if not exists donations_donor_date on public.donations(donor_id,created_at desc);
create index if not exists requests_member_status on public.borrow_requests(requester_id,status);
create index if not exists audit_created on public.audit_logs(created_at desc);

-- Existing policies include direct table writes. The client now uses scoped read views
-- and transaction functions only. Clear column grants as well as table grants.
do $$ declare t text; cols text; begin
 foreach t in array array['profiles','categories','products','inventory_units','borrow_requests','request_items','request_participants','loans','loan_items','reputation_ledger','donations','member_achievements','maintenance_records','inventory_movements','notifications','audit_logs','club_settings','member_directory'] loop
   execute format('revoke all on public.%I from public,anon,authenticated',t);
   select string_agg(quote_ident(column_name),',') into cols from information_schema.columns where table_schema='public' and table_name=t;
   execute format('revoke all (%s) on public.%I from public,anon,authenticated',cols,t);
 end loop;
end $$;

create function club_private.protect_owner() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then
   if old.role='super_admin' then raise exception 'The club owner cannot be deleted'; end if;
   return old;
 end if;
 if tg_op='UPDATE' and old.role='super_admin' and (new.role<>old.role or new.id<>old.id) then raise exception 'The club owner cannot be demoted'; end if;
 if new.role='super_admin' and (not new.is_active or new.membership_status<>'active') then raise exception 'The club owner must be active'; end if;
 return new;
end $$;
alter table public.profiles add constraint owner_is_active check(role<>'super_admin' or (is_active and membership_status='active'));
create trigger protect_owner before insert or update or delete on public.profiles for each row execute function club_private.protect_owner();

create function club_private.require_role(allowed public.club_role[] default enum_range(null::public.club_role))
returns public.club_role language plpgsql set search_path=public as $$
declare r public.club_role;
begin
 select role into r from profiles where id=auth.uid() and is_active and (membership_status='active' or membership_status='suspended' and suspended_until<=now()) for share;
 if public.current_role() is null or r is null or not (r=any(allowed)) then raise exception 'Permission denied' using errcode='42501'; end if;
 return r;
end $$;

create function club_private.audit(action text,entity text,id uuid,details jsonb default '{}') returns void
language sql set search_path=public as $$ insert into audit_logs(actor_id,action,entity_type,entity_id,after_data) values(auth.uid(),$1,$2,$3,$4) $$;
create function club_private.required(value text) returns text language plpgsql immutable as $$
begin if nullif(trim(value),'') is null or length(value)>4000 then raise exception 'Enter text between 1 and 4000 characters'; end if; return trim(value); end $$;

create function public.submit_request(product uuid, quantity int, purpose text, deadline date default null) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare id uuid;
begin
 perform club_private.require_role();
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if deadline<current_date then raise exception 'Project deadline has passed'; end if;
 if quantity is null or quantity<1 or quantity>(select count(*) from inventory_units where product_id=product and status='available') then raise exception 'Quantity exceeds available stock'; end if;
 id:=create_borrow_request(auth.uid(),null,false,club_private.required(purpose),deadline,trim(purpose),current_date+club_pref('borrowDays',7)::int,jsonb_build_array(jsonb_build_object('product_id',product,'quantity',quantity)));
 perform club_private.audit('request.submitted','borrow_request',id);
 return id;
end $$;
create function public.review_request(target uuid, approved boolean, reason text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare recipient uuid;
begin
 perform club_private.require_role('{super_admin,admin,moderator,secretary}');
 if approved then
  if exists(select 1 from request_items i join products p on p.id=i.product_id where i.request_id=target and not p.is_active) then raise exception 'Equipment is archived'; end if;
  perform approve_request(target,auth.uid());
 else
  reason:=club_private.required(reason);
  update borrow_requests set status='rejected',reviewed_at=now(),reviewed_by=auth.uid(),review_note=reason where id=target and status='pending' returning requester_id into recipient;
  if not found then raise exception 'Request is no longer pending'; end if;
  insert into notifications(recipient_id,actor_id,title,body) values(recipient,auth.uid(),'Request rejected',reason);
  perform club_private.audit('request.rejected','borrow_request',target,jsonb_build_object('reason',reason));
 end if;
end $$;
create function public.close_loan(target uuid, lost boolean default false) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare l loans; points int;
begin
 perform club_private.require_role('{super_admin,admin,moderator,secretary}');
 select * into strict l from loans where request_id=target for update;
 if not lost then perform return_loan(l.id,auth.uid()); return; end if;
 if l.status='returned' then raise exception 'Loan is closed'; end if;
 with closed as (update loan_items set return_note='Lost',returned_at=now() where loan_id=l.id and returned_at is null returning inventory_unit_id)
 update inventory_units set status='lost' where id in(select inventory_unit_id from closed);
 update loans set status='returned',returned_at=now(),notes='Non-return' where id=l.id;
 points:=-club_pref('nonReturnPenalty',20)::int;
 perform adjust_reputation(l.borrower_id,points,'Equipment not returned: '||l.id,auth.uid());
 perform club_private.audit('loan.lost','loan',l.id);
end $$;

create function club_private.valid_photo(path text) returns boolean language sql stable set search_path=public as $$
 select path is null or path = '/products/placeholder.svg' or path ~ '^/products/[a-z0-9-]+\.webp$' or
 (path like '/api/images/'||auth.uid()::text||'/%' and exists(select 1 from storage.objects where bucket_id='club-images' and name=substr(path,13)))
$$;
create function public.submit_contribution(item text, detail text, kind text, until_date date default null, photo text default null) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare target uuid;
begin
 perform club_private.require_role('{member}');
 if kind='lend' and (until_date is null or until_date<=current_date) then raise exception 'Choose a future return date'; end if;
 if not club_private.valid_photo(photo) then raise exception 'Invalid image'; end if;
 insert into donations(donor_id,item_name,description,contribution_type,lending_until,image_path) values(auth.uid(),club_private.required(item),club_private.required(detail),kind,until_date,photo) returning id into target;
 perform club_private.audit('contribution.submitted','donation',target);
 return target;
end $$;
create function public.review_contribution(target uuid, approved boolean, reason text default null, points int default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare d donations; product uuid;
begin
 perform club_private.require_role('{super_admin,admin,moderator,secretary}');
 select * into strict d from donations where id=target for update;
 if points is not null and (points not between 0 and 500 or public.current_role() not in ('super_admin','admin')) then raise exception 'Invalid award'; end if;
 perform assess_donation(target,auth.uid(),approved,coalesce(points,case when d.contribution_type='lend' then 3 else 5 end),reason);
 if approved then
  insert into products(name,sku,description,image_path) values(coalesce(d.item_name,d.description),'OFFER-'||d.id,d.description,d.image_path) returning id into product;
  insert into inventory_units(product_id,asset_tag) values(product,'UNIT-'||d.id);
  perform club_private.audit('equipment.received','product',product,jsonb_build_object('offer',target));
 end if;
end $$;

create function public.manage_member(target uuid, action text, reason text default null, points int default null, days int default null, new_role public.club_role default null) returns void
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
  if actor_role<>'super_admin' or new_role is null or new_role='super_admin' then raise exception 'Only the owner may assign roles'; end if;
  update profiles set role=new_role where id=target;
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
create function public.edit_profile(display_name text,team text,grade text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin perform club_private.require_role();
 update profiles set full_name=club_private.required(display_name),team_name=left(trim(team),200),academic_level=left(trim(grade),200) where id=auth.uid();
 perform club_private.audit('profile.updated','profile',auth.uid());
end $$;
create function public.set_preference(setting text, amount int) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform club_private.require_role('{super_admin,admin,moderator}');
 if amount is null or not (case setting when 'borrowDays' then amount between 1 and 90 when 'requestLimit' then amount between 1 and 20 when 'graceDays' then amount between 0 and 30 when 'onTimePoints' then amount between 0 and 100 when 'latePenalty' then amount between 0 and 100 when 'nonReturnPenalty' then amount between 1 and 500 else false end) then raise exception 'Invalid preference'; end if;
 insert into club_settings(key,value,updated_by) values('preferences',jsonb_build_object(setting,amount),auth.uid()) on conflict(key) do update set value=club_settings.value||excluded.value,updated_at=now(),updated_by=auth.uid();
 perform club_private.audit('setting.updated','club_settings',null,jsonb_build_object(setting,amount));
end $$;
create function public.save_equipment(target uuid, changes jsonb) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare category uuid; stock int; photos text[]; photo text;
begin
 perform club_private.require_role('{super_admin,admin,moderator,secretary}');
 if changes ? 'views' then
  select array(select jsonb_array_elements_text(changes->'views')) into photos;
  if cardinality(photos)>24 then raise exception 'Too many photos'; end if;
  foreach photo in array photos loop if not club_private.valid_photo(photo) then raise exception 'Invalid image'; end if; end loop;
 end if;
 if not club_private.valid_photo(changes->>'image') then raise exception 'Invalid image'; end if;
 if target is null then
  stock:=(changes->>'stock')::int;
  if stock is null or stock not between 1 and 999 then raise exception 'Invalid stock quantity'; end if;
  insert into categories(name) values(club_private.required(changes->>'category')) on conflict(name) do update set name=excluded.name returning id into category;
  insert into products(name,sku,category_id,description,condition,image_path,views) values(club_private.required(changes->>'name'),'RH-'||gen_random_uuid(),category,left(changes->>'description',4000),lower(changes->>'condition')::item_condition,changes->>'image',coalesce(photos,'{}')) returning id into target;
  insert into inventory_units(product_id,asset_tag,condition) select target,target::text||'-'||i,lower(changes->>'condition')::item_condition from generate_series(1,stock) i;
 else
  update products set description=coalesce(left(changes->>'description',4000),description),condition=coalesce(lower(changes->>'condition')::item_condition,condition),views=coalesce(photos,views),is_active=coalesce((changes->>'active')::boolean,is_active),updated_at=now() where id=target;
  if not found then raise exception 'Equipment not found'; end if;
 end if;
 perform club_private.audit('equipment.updated','product',target,changes);
 return target;
end $$;
create function public.read_notification(target uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin perform club_private.require_role(); update notifications set read_at=now() where id=target and recipient_id=auth.uid() and read_at is null; end $$;

-- Owner-executed projections expose specific columns. Every view scopes rows to the
-- validated membership; underlying tables and actor-parameter functions stay private.
create view public.workspace_members with(security_barrier=true) as
 select p.id,p.full_name as name,p.team_name as team,p.academic_level as grade,p.reputation_score as rep,initcap(replace(p.role::text,'_',' ')) as role,
 case when p.membership_status='suspended' and p.suspended_until<=now() then 'active' else p.membership_status end as status,
 case when p.id=auth.uid() or public.current_role() in ('admin','super_admin') then p.suspended_until end as "suspendedUntil",
 case when p.id=auth.uid() or public.current_role() in ('admin','super_admin') then p.status_reason end as "statusReason",
 array(select title from public.member_achievements a where a.member_id=p.id and a.is_verified order by a.created_at) as achievements
 from public.profiles p where public.current_role() is not null and (p.id=auth.uid() or public.current_role() in ('admin','super_admin','moderator') or public.current_role()='member' and p.is_active);
create view public.workspace_products with(security_barrier=true) as
 select p.id,p.name,p.sku as code,coalesce(c.name,'Other') as category,p.description,p.views,p.individual_cap as cap,initcap(p.condition::text) as condition,
 coalesce(p.image_path,'/products/placeholder.svg') as image,count(u.id) filter(where u.status='available')::int as available,count(u.id)::int as total
 from public.products p left join public.categories c on c.id=p.category_id left join public.inventory_units u on u.product_id=p.id
 where p.is_active and public.current_role() is not null group by p.id,c.name;
create view public.workspace_requests with(security_barrier=true) as
 select r.id,p.full_name as member,r.requester_id as "memberId",string_agg(pr.name,', ' order by pr.name) as product,sum(i.quantity)::int as qty,r.created_at as date,coalesce(l.due_at,r.requested_due_date) as due,
 case when l.status='returned' then coalesce(nullif(l.notes,'') ,'Returned') else initcap(r.status::text) end as status,r.purpose,r.competition_date as "projectDeadline"
 from public.borrow_requests r join public.profiles p on p.id=r.requester_id left join public.request_items i on i.request_id=r.id left join public.products pr on pr.id=i.product_id left join public.loans l on l.request_id=r.id
 where public.current_role() is not null and (r.requester_id=auth.uid() or public.is_staff()) group by r.id,p.full_name,l.id;
create view public.workspace_donations with(security_barrier=true) as
 select d.id,p.full_name as member,d.donor_id as "memberId",initcap(d.contribution_type) as kind,coalesce(d.item_name,d.description) as item,d.description as detail,
 initcap(d.status) as status,d.reputation_awarded as points,d.created_at as at,d.lending_until as "lendingUntil",d.image_path as image,reviewer.full_name as "reviewedBy",d.review_note as "rejectionReason"
 from public.donations d join public.profiles p on p.id=d.donor_id left join public.profiles reviewer on reviewer.id=d.assessed_by
 where public.current_role() is not null and (d.donor_id=auth.uid() or public.is_staff() or d.status='accepted');
create view public.workspace_reputation with(security_barrier=true) as
 select l.id,p.full_name as member,l.member_id as "memberId",l.delta as points,l.reason,a.full_name as actor,l.created_at as at from public.reputation_ledger l join public.profiles p on p.id=l.member_id left join public.profiles a on a.id=l.adjusted_by
 where public.current_role() is not null and (l.member_id=auth.uid() or public.current_role() in ('super_admin','admin','moderator'));
create view public.workspace_activity with(security_barrier=true) as
 select l.id,l.action as title,concat_ws(' · ',l.entity_type,l.entity_id::text,nullif(l.after_data,'{}')::text) as detail,'blue'::text as kind,l.created_at as at,p.full_name as actor
 from public.audit_logs l left join public.profiles p on p.id=l.actor_id where public.current_role() in ('super_admin','admin','moderator');
create view public.workspace_preferences with(security_barrier=true) as select key,value from public.club_settings where key='preferences' and public.current_role() is not null;
create view public.workspace_notifications with(security_barrier=true) as select id,title,body,created_at,read_at from public.notifications where recipient_id=auth.uid() and public.current_role() is not null;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('club-images','club-images',false,3145728,array['image/webp']);
drop policy if exists "moderators upload equipment images" on storage.objects;
drop policy if exists "moderators update equipment images" on storage.objects;
create policy "club image read" on storage.objects for select to authenticated using(bucket_id='club-images' and public.current_role() is not null and
 (split_part(name,'/',1)=auth.uid()::text or public.is_staff() or exists(select 1 from public.workspace_products p where '/api/images/'||name=p.image or '/api/images/'||name=any(p.views)) or exists(select 1 from public.workspace_donations d where d.image='/api/images/'||name)));
-- Uploads pass through the server image decoder. No authenticated INSERT policy.
revoke create on schema public from public,anon,authenticated;
do $$ declare f regprocedure; v text; begin
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in('submit_request','review_request','close_loan','submit_contribution','review_contribution','manage_member','edit_profile','set_preference','save_equipment','read_notification') loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  execute format('grant execute on function %s to authenticated',f);
 end loop;
 foreach v in array array['workspace_members','workspace_products','workspace_requests','workspace_donations','workspace_reputation','workspace_activity','workspace_notifications','workspace_preferences'] loop
  execute format('revoke all on public.%I from public,anon,authenticated',v);
  execute format('grant select on public.%I to authenticated',v);
 end loop;
end $$;
