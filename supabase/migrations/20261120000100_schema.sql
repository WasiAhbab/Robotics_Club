-- RoboHaven / Club Equipment Lending Tracker
-- Run once in Supabase SQL Editor on a new project. Uses Supabase Auth; never stores passwords here.
create extension if not exists pgcrypto;
create type public.club_role as enum ('super_admin','admin','moderator','secretary','member');
create type public.request_status as enum ('pending','approved','rejected','cancelled');
create type public.loan_status as enum ('active','partially_returned','returned','overdue');
create type public.item_condition as enum ('excellent','good','fair','repairable','damaged','unusable');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  student_id text unique,
  department text,
  team_name text,
  role public.club_role not null default 'member',
  reputation_score integer not null default 0,
  is_active boolean not null default true,
  academic_level text, membership_status text not null default 'active' check(membership_status in ('active','suspended','banned')),
  suspended_until timestamptz, status_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.categories (
  id uuid primary key default gen_random_uuid(), name text not null unique,
  description text, created_at timestamptz not null default now()
);
create table public.products (
  id uuid primary key default gen_random_uuid(), category_id uuid references public.categories(id) on delete set null,
  name text not null, sku text not null unique, description text, condition public.item_condition not null default 'good',
  image_path text, individual_cap integer not null default 1 check(individual_cap > 0),
  group_cap integer not null default 1 check(group_cap > 0),
  is_active boolean not null default true, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.inventory_units (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id),
  asset_tag text not null unique, serial_number text, condition public.item_condition not null default 'good',
  status text not null default 'available' check(status in ('available','on_loan','maintenance','retired','lost')),
  storage_location text, notes text, acquired_at date, created_at timestamptz not null default now()
);
create table public.borrow_requests (
  id uuid primary key default gen_random_uuid(), requester_id uuid not null references public.profiles(id),
  group_name text, is_group_request boolean not null default false,
  project_name text not null, competition_date date, purpose text not null,
  requested_due_date date not null, status public.request_status not null default 'pending',
  reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, review_note text,
  created_at timestamptz not null default now(),
  check(requested_due_date >= current_date)
);
create table public.request_items (
  id uuid primary key default gen_random_uuid(), request_id uuid not null references public.borrow_requests(id) on delete cascade,
  product_id uuid not null references public.products(id), quantity integer not null check(quantity > 0),
  unique(request_id, product_id)
);
create table public.request_participants (
  request_id uuid not null references public.borrow_requests(id) on delete cascade,
  member_id uuid not null references public.profiles(id), is_leader boolean not null default false,
  primary key(request_id,member_id)
);
create table public.loans (
  id uuid primary key default gen_random_uuid(), request_id uuid not null unique references public.borrow_requests(id),
  borrower_id uuid not null references public.profiles(id), issued_by uuid not null references public.profiles(id),
  issued_at timestamptz not null default now(), due_at date not null,
  status public.loan_status not null default 'active', returned_at timestamptz, notes text
);
create table public.loan_items (
  id uuid primary key default gen_random_uuid(), loan_id uuid not null references public.loans(id) on delete cascade,
  inventory_unit_id uuid not null references public.inventory_units(id),
  issued_condition public.item_condition not null, returned_condition public.item_condition,
  returned_at timestamptz, return_note text, unique(loan_id,inventory_unit_id)
);
create table public.reputation_ledger (
  id uuid primary key default gen_random_uuid(), member_id uuid not null references public.profiles(id),
  delta integer not null check(delta <> 0), reason text not null,
  source_type text not null check(source_type in ('on_time_return','late_return','non_return','donation','admin_adjustment','other')),
  source_id uuid, adjusted_by uuid references public.profiles(id), created_at timestamptz not null default now()
);
create table public.donations (
  id uuid primary key default gen_random_uuid(), donor_id uuid not null references public.profiles(id),
  description text not null, item_name text, contribution_type text not null default 'donation' check(contribution_type in ('donation','lend')), lending_until date, estimated_value numeric(12,2), currency text not null default 'BDT',
  status text not null default 'pending' check(status in ('pending','accepted','rejected')),
  check(contribution_type <> 'lend' or lending_until is not null),
  assessed_by uuid references public.profiles(id), assessed_at timestamptz, review_note text, reputation_awarded integer not null default 0,
  created_at timestamptz not null default now()
);
create table public.member_achievements (
  id uuid primary key default gen_random_uuid(), member_id uuid not null references public.profiles(id) on delete cascade,
  title text not null, description text, achievement_type text not null default 'project' check(achievement_type in ('project','competition','publication','certification')),
  achieved_at date, is_verified boolean not null default false, verified_by uuid references public.profiles(id), created_at timestamptz not null default now()
);
create table public.maintenance_records (
  id uuid primary key default gen_random_uuid(), inventory_unit_id uuid not null references public.inventory_units(id),
  reported_by uuid references public.profiles(id), issue text not null, status text not null default 'open'
  check(status in ('open','in_progress','resolved','written_off')), opened_at timestamptz not null default now(), resolved_at timestamptz, cost numeric(12,2)
);
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(), inventory_unit_id uuid references public.inventory_units(id),
  movement_type text not null, from_status text, to_status text, note text,
  performed_by uuid references public.profiles(id), created_at timestamptz not null default now()
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id), title text not null, body text not null, read_at timestamptz, created_at timestamptz not null default now()
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id),
  action text not null, entity_type text not null, entity_id uuid, before_data jsonb, after_data jsonb,
  created_at timestamptz not null default now()
);
create table public.club_settings (
  key text primary key, value jsonb not null, updated_by uuid references public.profiles(id), updated_at timestamptz not null default now()
);

create index on public.inventory_units(product_id,status);
create index on public.borrow_requests(status,created_at desc);
create index on public.loans(borrower_id,status,due_at);
create index on public.reputation_ledger(member_id,created_at desc);
create index if not exists member_achievements_member_date on public.member_achievements(member_id,achieved_at desc);
create index on public.notifications(recipient_id,read_at,created_at desc);

create or replace function public.current_role() returns public.club_role
language sql stable security definer set search_path=public
as $$ select role from public.profiles where id=auth.uid() and is_active=true and (membership_status='active' or (membership_status='suspended' and suspended_until <= now())) $$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path=public
as $$ select coalesce(public.current_role() in ('super_admin','admin','moderator','secretary'),false) $$;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.inventory_units enable row level security;
alter table public.borrow_requests enable row level security;
alter table public.request_items enable row level security;
alter table public.request_participants enable row level security;
alter table public.loans enable row level security;
alter table public.loan_items enable row level security;
alter table public.reputation_ledger enable row level security;
alter table public.donations enable row level security;
alter table public.maintenance_records enable row level security;
alter table public.member_achievements enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.club_settings enable row level security;

create policy "active member directory and own profile" on public.profiles for select to authenticated using (id=auth.uid() or (is_active=true and public.current_role() is not null));
create unique index if not exists profiles_single_super_admin on public.profiles ((role)) where role='super_admin';
create policy "leadership manages permitted profiles" on public.profiles for update to authenticated using(public.current_role() in ('super_admin','admin') and (public.current_role()='super_admin' or role not in ('admin','super_admin'))) with check(public.current_role() in ('super_admin','admin') and (public.current_role()='super_admin' or role not in ('admin','super_admin')));
create policy "super admin inserts leadership profiles" on public.profiles for insert to authenticated with check(public.current_role()='super_admin');
create policy "catalogue visible to authenticated" on public.categories for select to authenticated using(true);
create policy "staff manage categories" on public.categories for all to authenticated using(public.current_role() in ('super_admin','admin','moderator')) with check(public.current_role() in ('super_admin','admin','moderator'));
create policy "products visible to authenticated" on public.products for select to authenticated using(true);
create policy "staff manage products" on public.products for all to authenticated using(public.current_role() in ('super_admin','admin','moderator')) with check(public.current_role() in ('super_admin','admin','moderator'));
create policy "units visible to staff and borrowers" on public.inventory_units for select to authenticated using(public.is_staff() or status='available');
create policy "moderators manage units" on public.inventory_units for all to authenticated using(public.current_role() in ('super_admin','admin','moderator')) with check(public.current_role() in ('super_admin','admin','moderator'));
create policy "members create own requests" on public.borrow_requests for insert to authenticated with check(requester_id=auth.uid());
create policy "members read own requests staff read all" on public.borrow_requests for select to authenticated using(requester_id=auth.uid() or public.is_staff());
create policy "secretary and admins review requests" on public.borrow_requests for update to authenticated using(public.current_role() in ('super_admin','admin','secretary')) with check(public.current_role() in ('super_admin','admin','secretary'));
create policy "request items visible to owner and staff" on public.request_items for select to authenticated using(exists(select 1 from public.borrow_requests r where r.id=request_id and (r.requester_id=auth.uid() or public.is_staff())));
create policy "request items insert by owner" on public.request_items for insert to authenticated with check(exists(select 1 from public.borrow_requests r where r.id=request_id and r.requester_id=auth.uid() and r.status='pending'));
create policy "participants visible to owner and staff" on public.request_participants for select to authenticated using(exists(select 1 from public.borrow_requests r where r.id=request_id and (r.requester_id=auth.uid() or public.is_staff())));
create policy "loans visible to borrower and staff" on public.loans for select to authenticated using(borrower_id=auth.uid() or public.is_staff());
create policy "secretary issue and update loans" on public.loans for all to authenticated using(public.current_role() in ('super_admin','admin','secretary')) with check(public.current_role() in ('super_admin','admin','secretary'));
create policy "loan items visible to borrower and staff" on public.loan_items for select to authenticated using(exists(select 1 from public.loans l where l.id=loan_id and (l.borrower_id=auth.uid() or public.is_staff())));
create policy "secretary manage loan items" on public.loan_items for all to authenticated using(public.current_role() in ('super_admin','admin','secretary')) with check(public.current_role() in ('super_admin','admin','secretary'));
create policy "members read own reputation" on public.reputation_ledger for select to authenticated using(member_id=auth.uid() or public.is_staff());
create policy "admins adjust reputation" on public.reputation_ledger for insert to authenticated with check(public.current_role() in ('super_admin','admin') and adjusted_by=auth.uid());
create policy "donors and staff read donations" on public.donations for select to authenticated using(donor_id=auth.uid() or status='accepted' or public.current_role() in ('super_admin','admin','moderator','secretary'));
create policy "members submit pending contributions" on public.donations for insert to authenticated with check(donor_id=auth.uid() and public.current_role()='member' and status='pending' and assessed_by is null and reputation_awarded=0);
create policy "admins and secretaries assess donations" on public.donations for update to authenticated using(public.current_role() in ('super_admin','admin')) with check(public.current_role() in ('super_admin','admin'));
create policy "verified achievements are public" on public.member_achievements for select to authenticated using(is_verified=true or member_id=auth.uid() or public.is_staff());
create policy "leadership manages achievements" on public.member_achievements for all to authenticated using(public.current_role() in ('super_admin','admin','moderator','secretary')) with check(public.current_role() in ('super_admin','admin','moderator','secretary'));
create policy "staff manage maintenance" on public.maintenance_records for all to authenticated using(public.current_role() in ('super_admin','admin','moderator')) with check(public.current_role() in ('super_admin','admin','moderator'));
create policy "staff read movements" on public.inventory_movements for select to authenticated using(public.is_staff());
create policy "members read own notifications" on public.notifications for select to authenticated using(recipient_id=auth.uid());
create policy "members update own notifications" on public.notifications for update to authenticated using(recipient_id=auth.uid()) with check(recipient_id=auth.uid());
create policy "admins read audit" on public.audit_logs for select to authenticated using(public.current_role() in ('super_admin','admin'));
create policy "staff read settings" on public.club_settings for select to authenticated using(public.is_staff());
create policy "admins manage settings" on public.club_settings for all to authenticated using(public.current_role() in ('super_admin','admin','moderator')) with check(public.current_role() in ('super_admin','admin','moderator'));

revoke select on public.profiles from authenticated;
revoke insert, update, delete on public.profiles from authenticated;
grant select (id, full_name, department, team_name, role, reputation_score, is_active, academic_level, membership_status, created_at) on public.profiles to authenticated;
create or replace view public.member_directory with (security_invoker=true) as select id,full_name,department,team_name,role,reputation_score,academic_level,membership_status,created_at from public.profiles where is_active=true;
grant select on public.member_directory to authenticated;

-- Bootstrap a profile after signup. New accounts are members; promote the first Super Admin manually
-- in SQL Editor after verifying their auth.users id.
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public
as $$ begin insert into public.profiles(id,full_name) values(new.id,coalesce(new.raw_user_meta_data->>'full_name',split_part(new.email,'@',1))); return new; end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Create a private Storage bucket for catalog images. Upload via Supabase dashboard or trusted server.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('equipment','equipment',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
create policy "equipment images publicly readable" on storage.objects for select using(bucket_id='equipment');
create policy "moderators upload equipment images" on storage.objects for insert to authenticated with check(bucket_id='equipment' and public.current_role() in ('super_admin','admin','moderator'));
create policy "moderators update equipment images" on storage.objects for update to authenticated using(bucket_id='equipment' and public.current_role() in ('super_admin','admin','moderator')) with check(bucket_id='equipment' and public.current_role() in ('super_admin','admin','moderator'));


create or replace function public.account_access_status() returns jsonb
language sql stable security definer set search_path=public
as $$ select coalesce((select jsonb_build_object(
  'allowed', is_active and (membership_status='active' or (membership_status='suspended' and suspended_until <= now())),
  'membership_status', membership_status, 'suspended_until', suspended_until, 'reason', status_reason
) from public.profiles where id=auth.uid()), jsonb_build_object('allowed',false,'membership_status','missing')) $$;
grant execute on function public.account_access_status() to authenticated;
