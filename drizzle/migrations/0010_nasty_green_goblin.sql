CREATE TABLE "direct_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_a_id" uuid NOT NULL,
	"participant_b_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "direct_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"client_id" text,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "direct_conversations" ADD CONSTRAINT "direct_conversations_participant_a_id_profiles_id_fk" FOREIGN KEY ("participant_a_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_conversations" ADD CONSTRAINT "direct_conversations_participant_b_id_profiles_id_fk" FOREIGN KEY ("participant_b_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_conversation_id_direct_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."direct_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "direct_conversation_participants" ON "direct_conversations" USING btree ("participant_a_id","participant_b_id");--> statement-breakpoint
CREATE INDEX "direct_conversations_participant_a" ON "direct_conversations" USING btree ("participant_a_id","updated_at");--> statement-breakpoint
CREATE INDEX "direct_conversations_participant_b" ON "direct_conversations" USING btree ("participant_b_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_direct_message_client" ON "direct_messages" USING btree ("conversation_id","author_id","client_id");--> statement-breakpoint
CREATE INDEX "direct_messages_conversation_created" ON "direct_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "direct_messages_conversation_read" ON "direct_messages" USING btree ("conversation_id","read_at");