-- ========== TABLES ==========
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'member' check (role in ('admin','member')),
  created_at timestamptz not null default now()
);

create table public.books (
  id uuid primary key default gen_random_uuid(),
  isbn text unique,
  title text not null,
  author text,
  cover_url text,
  summary text,
  categories text[] not null default '{}',
  awards text,
  published_year int,
  rating_avg numeric(3,2),
  rating_count int,
  created_at timestamptz not null default now()
);

create table public.user_books (
  user_id uuid not null references public.profiles(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  status text not null default 'unread' check (status in ('unread','reading','read')),
  my_rating smallint check (my_rating between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.list_items (
  list_id uuid not null references public.lists(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (list_id, book_id)
);

create table public.checkouts (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  borrower_id uuid references public.profiles(id),
  borrower_name text,
  checked_out_at timestamptz not null default now(),
  due_date date,
  returned_at timestamptz,
  check (borrower_id is not null or borrower_name is not null)
);

-- A book can only be checked out once at a time
create unique index one_active_checkout_per_book
  on public.checkouts (book_id) where returned_at is null;
create index books_title_idx on public.books (lower(title));
create index books_categories_idx on public.books using gin (categories);

-- ========== HELPERS ==========
create function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  )
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Auto-create a profile whenever a user is added
create function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ========== SECURITY (Row Level Security) ==========
alter table public.profiles   enable row level security;
alter table public.books      enable row level security;
alter table public.user_books enable row level security;
alter table public.lists      enable row level security;
alter table public.list_items enable row level security;
alter table public.checkouts  enable row level security;

-- Profiles: everyone signed in can see names; you can edit only your own name
create policy "profiles readable" on public.profiles
  for select to authenticated using (true);
create policy "edit own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Books: everyone signed in can browse; only admins can add/edit/delete
create policy "books readable" on public.books
  for select to authenticated using (true);
create policy "admins add books" on public.books
  for insert to authenticated with check (public.is_admin());
create policy "admins edit books" on public.books
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins delete books" on public.books
  for delete to authenticated using (public.is_admin());

-- Read status and ratings: private to each person
create policy "own book status" on public.user_books
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- TBR lists: private to each person
create policy "own lists" on public.lists
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own list items" on public.list_items
  for all to authenticated
  using (exists (select 1 from public.lists l
                 where l.id = list_items.list_id and l.user_id = (select auth.uid())))
  with check (exists (select 1 from public.lists l
                      where l.id = list_items.list_id and l.user_id = (select auth.uid())));

-- Checkouts: everyone can see who has what; you check out and return for yourself,
-- admins can do it for anyone (including guests without accounts)
create policy "checkouts readable" on public.checkouts
  for select to authenticated using (true);
create policy "check out" on public.checkouts
  for insert to authenticated
  with check (borrower_id = (select auth.uid()) or public.is_admin());
create policy "return book" on public.checkouts
  for update to authenticated
  using (borrower_id = (select auth.uid()) or public.is_admin())
  with check (borrower_id = (select auth.uid()) or public.is_admin());
create policy "admins delete checkouts" on public.checkouts
  for delete to authenticated using (public.is_admin());

-- ========== PERMISSIONS (signed-in users only, nothing for anonymous visitors) ==========
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.books to authenticated;
grant select, insert, update, delete on public.user_books to authenticated;
grant select, insert, update, delete on public.lists to authenticated;
grant select, insert, update, delete on public.list_items to authenticated;
grant select, insert, delete on public.checkouts to authenticated;
grant update (returned_at, due_date) on public.checkouts to authenticated;
alter table public.books add column ol_work_key text unique;