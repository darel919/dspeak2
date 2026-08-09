ALTER TABLE "notification_preferences" ADD COLUMN "push" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "sound" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "previews" boolean DEFAULT true NOT NULL;--> statement-breakpoint
