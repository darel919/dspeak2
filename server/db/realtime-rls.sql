-- dSpeak: Supabase Realtime authorization + publication setup
--
-- The Nitro server publishes chat and notification events into Realtime
-- broadcast topics over the private service-role client (see
-- server/utils/dspeak-realtime.js). Browser/desktop clients subscribe using
-- the anon key over a JWT-authenticated websocket (see
-- app/utils/supabase-client.js and app/stores/chat.js). Anon-key clients must
-- never see broadcasts they are not entitled to, so enforce Realtime
-- Authorization below.
--
-- Placeholders are shown with example.com values; replace with real values:
--   <PROJECT_REF>.supabase.co   your Supabase project host
--   example.com                 your app origin
--
-- ---------------------------------------------------------------------------
-- 1) Enable the realtime publication so Realtime starts on the project.
-- ---------------------------------------------------------------------------
-- Realtime Broadcasts do not need any table rows. This statement only marks
-- one schema table so the `supabase_realtime` publication is non-empty and
-- Realtime becomes selectable in the dashboard.

alter publication supabase_realtime add table public.channels;

-- ---------------------------------------------------------------------------
-- 2) Realtime Authorization policy (Dashboard > Realtime > Authorization,
--    then "Create new Policy" on the `realtime.messages` prepended table).
-- ---------------------------------------------------------------------------
-- The broadcast topic (the Realtime channel id) selects which clients may
-- receive the message. Topics used by dSpeak:
--   chat:<channelId>      direct channel chat broadcasts
--   notify:<userId>       per-user notification stream
--   global                app-wide events (profile updates, etc.)
--
-- Paste this into the policy's `SELECT` snippet and save. The `auth.*` helpers
-- resolve the JWT-authenticated user; only that user's allowed topics pass.

-- Realtime Authorization: realtime.messages (SELECT)
select
  case
    when topic like 'chat:%' then exists (
      select 1
      from public.channel_members cm
      where cm.channel_id = substring(topic from 6)
        and cm.user_id = auth.uid()
    )
    when topic like 'notify:%' then substring(topic from 8) = auth.uid()::text
    when topic = 'global' then true
    else false
  end
from realtime.messages
where auth.role() = 'authenticated'
  and topic is not null;

-- ---------------------------------------------------------------------------
-- 3) Client-side JWT claims already gate subscription. Ensure Supabase
--    issues the Realtime JWT with the app project as the issuer; the anon
--    key in nuxt runtime config points at the same project:
--
--   SUPABASE_URL=https://<PROJECT_REF>.supabase.co
--   SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
--
-- With Realtime Authorization active, a client cannot receive a broadcast for
-- a topic it is not authorized to read, regardless of the anon key.
--
-- 4) Row-level security for the underlying tables (channels, channel_members)
--    is separate and unchanged by Realtime. Apply normal RLS there if direct
--    table access via the data API is exposed.