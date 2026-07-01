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
  }
] as const;
