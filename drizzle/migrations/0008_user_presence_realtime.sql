CREATE TABLE "user_presence" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'offline' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_manual_override" boolean DEFAULT false NOT NULL,
	"platform" text DEFAULT 'web' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_presence" ADD CONSTRAINT "user_presence_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
DROP POLICY IF EXISTS "dspeak_realtime_read" ON realtime.messages;
--> statement-breakpoint
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