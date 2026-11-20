-- Existing clients keep their views and column grants. Only the projection roles
-- can read the underlying tables, subject to their dedicated SELECT policies.
create role robohaven_view_reader nologin;
create role robohaven_total_reader nologin;
grant robohaven_view_reader, robohaven_total_reader to current_user;
create schema robohaven_reads;
revoke all on schema robohaven_reads from public, anon, authenticated;
grant usage on schema robohaven_reads to authenticated, service_role;
grant usage, create on schema robohaven_reads to robohaven_view_reader, robohaven_total_reader;
grant usage on schema public, auth to robohaven_view_reader, robohaven_total_reader;
grant execute on function public.current_role(), public.is_staff(), auth.uid() to robohaven_view_reader, robohaven_total_reader;

grant select on public.profiles, public.member_achievements, public.categories, public.products,
  public.inventory_units, public.request_items, public.borrow_requests, public.loans,
  public.donations, public.reputation_ledger, public.audit_logs, public.club_settings,
  public.notifications to robohaven_view_reader;
grant select (status, reputation_awarded) on public.donations to robohaven_total_reader;

-- Profiles supply display names on historical records, including departed members.
-- The member projection separately masks sanction details and filters directory entries.
create policy projection_profiles on public.profiles for select to robohaven_view_reader using (public.current_role() is not null);
create policy projection_achievements on public.member_achievements for select to robohaven_view_reader using (is_verified and public.current_role() is not null);
create policy projection_categories on public.categories for select to robohaven_view_reader using (public.current_role() is not null);
create policy projection_products on public.products for select to robohaven_view_reader using (public.current_role() is not null);
create policy projection_stock on public.inventory_units for select to robohaven_view_reader using (public.current_role() is not null);
create policy projection_requests on public.borrow_requests for select to robohaven_view_reader using (public.current_role() is not null and (requester_id=(select auth.uid()) or public.is_staff()));
create policy projection_request_items on public.request_items for select to robohaven_view_reader using (exists(select 1 from public.borrow_requests r where r.id=request_id));
create policy projection_loans on public.loans for select to robohaven_view_reader using (public.current_role() is not null and (borrower_id=(select auth.uid()) or public.is_staff()));
create policy projection_donations on public.donations for select to robohaven_view_reader using (public.current_role() is not null and (donor_id=(select auth.uid()) or public.is_staff() or (status='accepted' and contribution_type='donation')));
create policy projection_total on public.donations for select to robohaven_total_reader using (public.current_role() is not null and status='accepted');
create policy projection_reputation on public.reputation_ledger for select to robohaven_view_reader using (public.current_role() is not null and (member_id=(select auth.uid()) or public.current_role() in ('super_admin','admin','moderator')));
create policy projection_activity on public.audit_logs for select to robohaven_view_reader using (public.current_role() in ('super_admin','admin','moderator'));
create policy projection_settings on public.club_settings for select to robohaven_view_reader using (key='preferences' and public.current_role() is not null);
create policy projection_notifications on public.notifications for select to robohaven_view_reader using (recipient_id=(select auth.uid()) and public.current_role() is not null);

do $$
declare
  projection text;
  reader name;
  definition text;
begin
  foreach projection in array array['workspace_members','workspace_products','workspace_requests',
    'workspace_donations','workspace_reputation','workspace_activity','workspace_preferences',
    'workspace_notifications','workspace_contribution_total']
  loop
    reader := case when projection='workspace_contribution_total' then 'robohaven_total_reader' else 'robohaven_view_reader' end;
    definition := pg_get_viewdef(format('public.%I',projection)::regclass);
    execute format('create view robohaven_reads.%I with (security_barrier=true) as %s',projection,definition);
    execute format('alter view robohaven_reads.%I owner to %I',projection,reader);
    execute format('revoke all on robohaven_reads.%I from public, anon, authenticated',projection);
    execute format('grant select on robohaven_reads.%I to authenticated, service_role',projection);
    execute format('create or replace view public.%I with (security_invoker=true,security_barrier=true) as select * from robohaven_reads.%I',projection,projection);
  end loop;
end $$;
revoke create on schema robohaven_reads from robohaven_view_reader, robohaven_total_reader;
revoke robohaven_view_reader, robohaven_total_reader from current_user;
