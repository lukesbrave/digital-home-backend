-- One operational receipt per successfully processed Stripe event, in the same
-- transaction as completion. This is not a revenue metric: a processed event
-- can be a trial, refund, renewal or no-op. Payloads contain no buyer details.
create or replace function public.home_events_on_payment_processed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.processed_at is null and new.processed_at is not null
     and coalesce(new.result->>'ignored', '') = '' then
    insert into public.home_events(actor_type,actor,action,subject_type,subject_id,lead_id,payload,evidence)
    values ('webhook','stripe','payment.processed','payment_event',new.id::text,
      case when (new.result->>'leadId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
           then (new.result->>'leadId')::uuid end,
      jsonb_strip_nulls(jsonb_build_object('livemode',new.livemode)),
      jsonb_build_object('webhook_id',public.home_event_id_or_null(new.provider_event_id)));
  end if;
  return new;
end $$;
revoke all on function public.home_events_on_payment_processed() from public, anon, authenticated;
drop trigger if exists home_events_payment_processed on public.payment_events;
create trigger home_events_payment_processed after update of processed_at on public.payment_events
for each row execute function public.home_events_on_payment_processed();
