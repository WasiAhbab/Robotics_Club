-- The club milestone includes private loans without exposing individual submissions.
create view public.workspace_contribution_total with (security_barrier=true) as
select 1 as id, coalesce(sum(reputation_awarded), 0)::integer as points
from public.donations where status='accepted'
having public.current_role() is not null;
revoke all on public.workspace_contribution_total from public, anon, authenticated;
grant select on public.workspace_contribution_total to authenticated;
