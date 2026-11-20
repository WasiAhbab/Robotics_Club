create or replace view public.workspace_donations with(security_barrier=true) as
 select d.id,p.full_name as member,d.donor_id as "memberId",initcap(d.contribution_type) as kind,coalesce(d.item_name,d.description) as item,d.description as detail,
 initcap(d.status) as status,d.reputation_awarded as points,d.created_at as at,d.lending_until as "lendingUntil",d.image_path as image,reviewer.full_name as "reviewedBy",d.review_note as "rejectionReason"
 from public.donations d join public.profiles p on p.id=d.donor_id left join public.profiles reviewer on reviewer.id=d.assessed_by
 where public.current_role() is not null and (d.donor_id=auth.uid() or public.is_staff() or (d.status='accepted' and d.contribution_type='donation'));

alter policy "donors and staff read donations" on public.donations
using (public.current_role() is not null and
       (donor_id = auth.uid() or public.is_staff() or
        (status = 'accepted' and contribution_type = 'donation')));
