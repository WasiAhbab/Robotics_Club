// The hosted Auth and Storage services own these tables in a real project.
export const platform = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(bucket_id text,name text);
alter table storage.objects enable row level security;
grant usage on schema public,auth,storage to authenticated,anon;
grant select on storage.objects to authenticated;
alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
`;
