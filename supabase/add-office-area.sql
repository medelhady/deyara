-- Which district an office works in.
--
-- The list is only worth calling from if it can be read by area: an office in لكصر is the one to
-- ring about the twenty-four requests in لكصر, and without this the whole list is called in order
-- and most of it about houses it does not have.
--
-- Safe to run more than once.
alter table real_estate_offices
  add column if not exists area text;

comment on column real_estate_offices.area is
  'The district the office works in -- read off the screenshot when it shows, typed by hand when it does not.';
