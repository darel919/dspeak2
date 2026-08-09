ALTER TABLE "channels" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "policy" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "slow_mode" integer DEFAULT 0 NOT NULL;