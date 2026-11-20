-- Apply to all clients, including earlier REST integrations.
create function club_private.pending_request_limit() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.requester_id::text,0));
 if (select count(*) from borrow_requests where requester_id=new.requester_id and status='pending') >= club_pref('requestLimit',3) then raise exception 'PENDING_LIMIT_REACHED'; end if;
 return new;
end $$;
create trigger enforce_pending_limit before insert on public.borrow_requests for each row execute function club_private.pending_request_limit();

create unique index loan_items_one_open_issue on public.loan_items(inventory_unit_id) where returned_at is null;
create function club_private.guard_unit() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if old.status='on_loan' and new.status<>'on_loan' and exists(select 1 from loan_items where inventory_unit_id=new.id and returned_at is null) then raise exception 'Unit has an open loan'; end if;
 return new;
end $$;
create trigger protect_checked_out_unit before update of status on public.inventory_units for each row execute function club_private.guard_unit();
