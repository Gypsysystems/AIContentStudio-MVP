-- Correct the schema registry after the AI Connections migration was deployed.
insert into public.cloud_schema_versions(component, version)
values ('ai-connections', 1)
on conflict (component) do update set version = excluded.version;