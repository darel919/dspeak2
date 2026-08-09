-- dSpeak Supabase Realtime authorization setup.
-- This script is safe to execute repeatedly after the application tables exist.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'channels'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.channels;
  END IF;
END
$$;

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dspeak_realtime_read" ON realtime.messages;

CREATE POLICY "dspeak_realtime_read"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  auth.role() = 'authenticated'
  AND topic IS NOT NULL
  AND (
    topic = 'global'
    OR (
      topic LIKE 'notify:%'
      AND substring(topic FROM 8) = auth.uid()::text
    )
    OR (
      topic LIKE 'room:%'
      AND EXISTS (
        SELECT 1
        FROM public.room_memberships rm
        WHERE rm.room_id::text = substring(topic FROM 6)
          AND rm.user_id = auth.uid()
      )
    )
    OR (
      topic LIKE 'chat:%'
      AND EXISTS (
        SELECT 1
        FROM public.room_memberships rm
        JOIN public.channels c ON c.room_id = rm.room_id
        WHERE c.id::text = substring(topic FROM 6)
          AND rm.user_id = auth.uid()
      )
    )
  )
);

DROP POLICY IF EXISTS "dspeak_realtime_write" ON realtime.messages;

CREATE POLICY "dspeak_realtime_write"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  auth.role() = 'authenticated'
  AND topic LIKE 'chat:%'
  AND EXISTS (
    SELECT 1
    FROM public.room_memberships rm
    JOIN public.channels c ON c.room_id = rm.room_id
    WHERE c.id::text = substring(topic FROM 6)
      AND rm.user_id = auth.uid()
  )
);
