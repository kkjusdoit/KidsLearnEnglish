export const migrations = [
  {
    name: "001_init",
    sql: `
      create extension if not exists pgcrypto;

      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );

      create table if not exists students (
        id uuid primary key default gen_random_uuid(),
        student_id text not null unique,
        name text not null,
        display_name text not null,
        active boolean not null default true,
        created_at timestamptz not null default now()
      );

      create table if not exists lessons (
        id uuid primary key default gen_random_uuid(),
        lesson_date date not null unique,
        title text not null,
        status text not null check (status in ('draft', 'published')) default 'draft',
        created_at timestamptz not null default now()
      );

      create table if not exists lesson_pages (
        id uuid primary key default gen_random_uuid(),
        lesson_id uuid not null references lessons(id) on delete cascade,
        page_order integer not null,
        page_type text not null check (page_type in ('word', 'sentence')),
        text text not null,
        audio_url text not null,
        image_url text,
        start_ms integer,
        end_ms integer,
        unique (lesson_id, page_order)
      );

      create table if not exists checkins (
        id uuid primary key default gen_random_uuid(),
        student_id uuid not null references students(id) on delete cascade,
        lesson_id uuid not null references lessons(id) on delete cascade,
        completed_at timestamptz not null default now(),
        page_count integer not null,
        reward_text text not null,
        unique (student_id, lesson_id)
      );

      create table if not exists recordings (
        id uuid primary key default gen_random_uuid(),
        student_id uuid not null references students(id) on delete cascade,
        lesson_id uuid not null references lessons(id) on delete cascade,
        page_id uuid not null references lesson_pages(id) on delete cascade,
        audio_url text not null,
        created_at timestamptz not null default now(),
        expires_at timestamptz not null
      );
    `
  },
  {
    name: "002_student_historical_checkins",
    sql: `
      alter table students
        add column if not exists carry_checkin_days integer not null default 0,
        add column if not exists historical_checkins_confirmed_at timestamptz;

      alter table students
        drop constraint if exists students_carry_checkin_days_check;

      alter table students
        add constraint students_carry_checkin_days_check
        check (carry_checkin_days >= 0);
    `
  },
  {
    name: "003_student_checkin_calendar",
    sql: `
      create table if not exists student_checkin_days (
        id uuid primary key default gen_random_uuid(),
        student_id uuid not null references students(id) on delete cascade,
        checkin_date date not null,
        checked boolean not null default true,
        source text not null check (source in ('manual', 'lesson')),
        created_at timestamptz not null default now(),
        unique (student_id, checkin_date)
      );

      insert into student_checkin_days (student_id, checkin_date, checked, source)
      select
        c.student_id,
        l.lesson_date,
        true,
        'lesson'
      from checkins c
      join lessons l on l.id = c.lesson_id
      on conflict (student_id, checkin_date)
      do update set checked = true, source = 'lesson';

      insert into student_checkin_days (student_id, checkin_date, checked, source)
      select
        s.id,
        generated.checkin_date,
        true,
        'manual'
      from students s
      join lateral (
        select ('2026-06-29'::date + offset_days) as checkin_date
        from generate_series(0, greatest(s.carry_checkin_days - 1, 0)) as offset_days
      ) generated on s.carry_checkin_days > 0
      on conflict (student_id, checkin_date) do nothing;
    `
  },
  {
    name: "004_student_checkin_calendar_repair",
    sql: `
      create table if not exists student_checkin_days (
        id uuid primary key default gen_random_uuid(),
        student_id uuid not null references students(id) on delete cascade,
        checkin_date date not null,
        checked boolean not null default true,
        source text not null check (source in ('manual', 'lesson')),
        created_at timestamptz not null default now()
      );

      alter table student_checkin_days
        add column if not exists checked boolean;

      update student_checkin_days
      set checked = true
      where checked is null;

      alter table student_checkin_days
        alter column checked set default true;

      alter table student_checkin_days
        alter column checked set not null;

      with ranked as (
        select
          id,
          row_number() over (
            partition by student_id, checkin_date
            order by
              checked desc,
              case when source = 'lesson' then 0 else 1 end,
              created_at asc,
              id asc
          ) as row_rank
        from student_checkin_days
      )
      delete from student_checkin_days
      where id in (
        select id
        from ranked
        where row_rank > 1
      );

      create unique index if not exists student_checkin_days_student_date_key
        on student_checkin_days (student_id, checkin_date);
    `
  }
] as const;
