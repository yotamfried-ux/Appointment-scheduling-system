-- A business kind for gel-polish and manicure businesses ("nails"). Forward-only: the check constraint is replaced by one that also allows it.
alter table public.businesses drop constraint businesses_kind_check;
alter table public.businesses add constraint businesses_kind_check check (kind in ('barber','beauty','nails','trainer','teacher','clinic','other'));
