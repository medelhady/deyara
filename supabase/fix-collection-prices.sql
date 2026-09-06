-- One-off: repairs rents collected before the bot read "60" as sixty thousand.
--
-- People say the number in thousands and leave the zeros off, and two thirds of the first answers
-- arrived that way -- so the sheet held rents of 60, 70 and 100 ouguiya, which are not prices for
-- anything. The bot reads them correctly now; this fixes what was already stored.
--
-- Safe to run more than once: after the first pass every value is at least 1000, so nothing matches
-- the condition again. Zero is left alone -- a commission of zero means "none", not "missing".
--
-- Run the SELECT first and look at it. It shows exactly which rows will change and to what.

-- 1. Preview
select
  id,
  side,
  area,
  price as price_now,
  price * 1000 as price_after,
  commission as commission_now,
  case when commission > 0 and commission < 1000 then commission * 1000 else commission end as commission_after,
  specs
from collection_entries
where (price > 0 and price < 1000)
   or (commission > 0 and commission < 1000)
order by created_at desc;

-- 2. Apply
update collection_entries
set price = price * 1000
where price > 0 and price < 1000;

update collection_entries
set commission = commission * 1000
where commission > 0 and commission < 1000;
