-- Mystic Mikado anonymous discovery schema (Supabase Postgres)
-- No accounts, reader IDs, article content, or per-batch history are stored.

create extension if not exists pgcrypto;

create table if not exists public.feed_catalog (
  url text primary key,
  title text not null,
  description text not null default '',
  category text not null default 'Independent',
  seeded boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.feed_stats (
  url text primary key references public.feed_catalog(url) on delete cascade,
  submissions bigint not null default 0 check (submissions >= 0),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.co_subscriptions (
  feed_a text not null references public.feed_catalog(url) on delete cascade,
  feed_b text not null references public.feed_catalog(url) on delete cascade,
  co_count bigint not null default 0 check (co_count >= 0),
  primary key (feed_a, feed_b),
  check (feed_a < feed_b)
);

create table if not exists public.submission_tokens (
  nonce_hash text primary key,
  expires_at timestamptz not null,
  used_at timestamptz
);

-- IP addresses are never stored. This table stores only a salted SHA-256 digest, with a 24-hour expiry.
create table if not exists public.ip_rate_limits (
  ip_hash text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  expires_at timestamptz not null
);

create index if not exists feed_stats_submissions_idx on public.feed_stats(submissions desc);
create index if not exists co_subscriptions_a_idx on public.co_subscriptions(feed_a);
create index if not exists co_subscriptions_b_idx on public.co_subscriptions(feed_b);
create index if not exists submission_tokens_expiry_idx on public.submission_tokens(expires_at);
create index if not exists ip_rate_limits_expiry_idx on public.ip_rate_limits(expires_at);

-- The database is server-only. Browsers never receive the service-role key and cannot query these tables directly.
alter table public.feed_catalog enable row level security;
alter table public.feed_stats enable row level security;
alter table public.co_subscriptions enable row level security;
alter table public.submission_tokens enable row level security;
alter table public.ip_rate_limits enable row level security;
revoke all on table public.feed_catalog, public.feed_stats, public.co_subscriptions, public.submission_tokens, public.ip_rate_limits from public, anon, authenticated;
grant all on table public.feed_catalog, public.feed_stats, public.co_subscriptions, public.submission_tokens, public.ip_rate_limits to service_role;

-- Atomic per-hash rate limiter. The caller supplies a salted hash only; the raw IP never reaches SQL.
create or replace function public.try_consume_rate_limit(p_ip_hash text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
  reset_window boolean;
begin
  insert into public.ip_rate_limits(ip_hash, window_started_at, request_count, expires_at)
  values (p_ip_hash, now(), 1, now() + interval '24 hours')
  on conflict (ip_hash) do update set
    request_count = case
      when public.ip_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1
      else public.ip_rate_limits.request_count + 1
    end,
    window_started_at = case
      when public.ip_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
      else public.ip_rate_limits.window_started_at
    end,
    expires_at = now() + interval '24 hours'
  returning request_count into current_count;
  return current_count <= greatest(1, p_limit);
end;
$$;

-- Aggregation only: every opted-in batch increments feed and pair counts once. There is no batch table.
create or replace function public.submit_anonymous_batch(p_urls text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_urls is null or cardinality(p_urls) < 1 or cardinality(p_urls) > 100 then
    raise exception 'batch size out of bounds';
  end if;

  insert into public.feed_catalog(url, title, description, category, seeded)
  select u,
         regexp_replace(split_part(regexp_replace(u, '^https?://', ''), '/', 1), '^www[.]', ''),
         'Added by an anonymous opt-in subscription batch.',
         'Independent', false
  from unnest(p_urls) as rows(u)
  on conflict (url) do nothing;

  insert into public.feed_stats(url, submissions, last_seen_at)
  select u, 1, now() from unnest(p_urls) as rows(u)
  on conflict (url) do update set submissions = public.feed_stats.submissions + 1, last_seen_at = now();

  insert into public.co_subscriptions(feed_a, feed_b, co_count)
  select a.u, b.u, 1
  from unnest(p_urls) as a(u)
  join unnest(p_urls) as b(u) on a.u < b.u
  on conflict (feed_a, feed_b) do update set co_count = public.co_subscriptions.co_count + 1;
end;
$$;

create or replace function public.get_popular_feeds(p_limit integer default 12)
returns table(
  url text, title text, description text, category text,
  popularity bigint, co_subscription bigint, why text, seeded boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select c.url, c.title, c.description, c.category,
         coalesce(s.submissions,0)::bigint as popularity,
         0::bigint as co_subscription,
         case when c.seeded then 'Pre-populated demo baseline; ranking improves as opt-in batches arrive.'
              else 'Popular in anonymous opt-in subscription batches.' end as why,
         c.seeded
  from public.feed_catalog c
  left join public.feed_stats s on s.url=c.url
  order by coalesce(s.submissions,0) desc, c.title asc
  limit greatest(1,least(30,coalesce(p_limit,12)));
$$;

create or replace function public.get_recommendations(p_urls text[], p_limit integer default 10)
returns table(
  url text, title text, description text, category text,
  popularity bigint, co_subscription bigint, why text, seeded boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with followed as (
    select distinct u.url from unnest(coalesce(p_urls, array[]::text[])) as u(url)
  ), overlaps as (
    select case when cs.feed_a = f.url then cs.feed_b else cs.feed_a end as candidate,
           sum(cs.co_count)::bigint as overlap_count,
           count(distinct f.url)::integer as shared_feed_count
    from public.co_subscriptions cs
    join followed f on cs.feed_a=f.url or cs.feed_b=f.url
    group by candidate
  )
  select c.url,c.title,c.description,c.category,
         coalesce(s.submissions,0)::bigint as popularity,
         coalesce(o.overlap_count,0)::bigint as co_subscription,
         case when coalesce(o.overlap_count,0)>0
              then 'Frequently followed alongside ' || o.shared_feed_count || ' of your subscriptions.'
              when c.seeded then 'Curated demo suggestion; anonymous overlap will improve as batches arrive.'
              else 'Popular among anonymous opt-in batches.' end as why,
         c.seeded
  from public.feed_catalog c
  left join public.feed_stats s on s.url=c.url
  left join overlaps o on o.candidate=c.url
  where not exists (select 1 from followed f where f.url=c.url)
  order by (coalesce(o.overlap_count,0)*5 + coalesce(s.submissions,0)) desc, c.title asc
  limit greatest(1,least(20,coalesce(p_limit,10)));
$$;

-- Only service_role can invoke write/rate-limit RPCs. Anonymous browser traffic must go through /api.
revoke all on function public.try_consume_rate_limit(text,integer,integer) from public, anon, authenticated;
revoke all on function public.submit_anonymous_batch(text[]) from public, anon, authenticated;
revoke all on function public.get_popular_feeds(integer) from public, anon, authenticated;
revoke all on function public.get_recommendations(text[],integer) from public, anon, authenticated;
grant execute on function public.try_consume_rate_limit(text,integer,integer) to service_role;
grant execute on function public.submit_anonymous_batch(text[]) to service_role;
grant execute on function public.get_popular_feeds(integer) to service_role;
grant execute on function public.get_recommendations(text[],integer) to service_role;

-- Curated demo discovery seed. Scores are placeholders to keep Discover populated during evaluation;
-- they are NOT presented as verified real readers or unique people.
insert into public.feed_catalog(url,title,description,category,seeded) values
('https://nasa.gov/rss/dyn/breaking_news.rss','NASA Breaking News','Spaceflight, missions and discoveries from NASA.','Science',true),
('https://feeds.arstechnica.com/arstechnica/index','Ars Technica','Technology, science, policy and computing.','Technology',true),
('https://theverge.com/rss/index.xml','The Verge','Technology, culture and the future.','Technology',true),
('https://hnrss.org/frontpage','Hacker News — Front Page','Technology and startup stories shared by the community.','Technology',true),
('https://xkcd.com/atom.xml','xkcd','A webcomic of romance, sarcasm, math and language.','Comics',true),
('https://smashingmagazine.com/feed','Smashing Magazine','Practical articles for designers and developers.','Design',true),
('https://hacks.mozilla.org/feed','Mozilla Hacks','Web platform news and developer ideas.','Development',true),
('https://blog.cloudflare.com/rss','The Cloudflare Blog','Internet infrastructure, security and performance.','Technology',true),
('https://github.blog/feed','The GitHub Blog','Software, open source and developer workflows.','Development',true),
('https://css-tricks.com/feed','CSS-Tricks','CSS, frontend engineering and web craft.','Development',true),
('https://feeds.bbci.co.uk/news/rss.xml','BBC News','World reporting and current affairs.','News',true),
('https://feeds.npr.org/1001/rss.xml','NPR News','News and public-interest reporting.','News',true),
('https://reddit.com/r/programming/.rss','Reddit · r/programming','Community-shared programming discussions.','Community',true),
('https://quantamagazine.org/feed','Quanta Magazine','Mathematics, physics, computer science and life sciences.','Science',true)
on conflict(url) do update set title=excluded.title,description=excluded.description,category=excluded.category,seeded=true;

insert into public.feed_stats(url,submissions) values
('https://nasa.gov/rss/dyn/breaking_news.rss',94),
('https://feeds.arstechnica.com/arstechnica/index',88),
('https://theverge.com/rss/index.xml',82),
('https://hnrss.org/frontpage',79),
('https://xkcd.com/atom.xml',71),
('https://smashingmagazine.com/feed',65),
('https://hacks.mozilla.org/feed',58),
('https://blog.cloudflare.com/rss',54),
('https://github.blog/feed',51),
('https://css-tricks.com/feed',43),
('https://feeds.bbci.co.uk/news/rss.xml',40),
('https://feeds.npr.org/1001/rss.xml',36),
('https://reddit.com/r/programming/.rss',33),
('https://quantamagazine.org/feed',29)
on conflict(url) do update set submissions=greatest(public.feed_stats.submissions,excluded.submissions);

-- Demo co-subscription edges seed the overlap model so the first Discover page isn't empty.
insert into public.co_subscriptions(feed_a,feed_b,co_count) values
('https://feeds.arstechnica.com/arstechnica/index','https://theverge.com/rss/index.xml',22),
('https://blog.cloudflare.com/rss','https://github.blog/feed',21),
('https://hacks.mozilla.org/feed','https://smashingmagazine.com/feed',18),
('https://feeds.arstechnica.com/arstechnica/index','https://hnrss.org/frontpage',26),
('https://hnrss.org/frontpage','https://github.blog/feed',20),
('https://nasa.gov/rss/dyn/breaking_news.rss','https://quantamagazine.org/feed',17),
('https://feeds.bbci.co.uk/news/rss.xml','https://feeds.npr.org/1001/rss.xml',19),
('https://css-tricks.com/feed','https://smashingmagazine.com/feed',24),
('https://github.blog/feed','https://smashingmagazine.com/feed',16),
('https://reddit.com/r/programming/.rss','https://hnrss.org/frontpage',14)
on conflict(feed_a,feed_b) do update set co_count=greatest(public.co_subscriptions.co_count,excluded.co_count);
