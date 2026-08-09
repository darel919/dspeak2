ALTER TABLE "room_soundboards" ADD COLUMN "category" text DEFAULT 'General' NOT NULL;--> statement-breakpoint
ALTER TABLE "room_soundboards" ADD COLUMN "icon" text DEFAULT '🔊' NOT NULL;--> statement-breakpoint
ALTER TABLE "room_soundboards" ADD COLUMN "icon_image_key" text;--> statement-breakpoint
ALTER TABLE "room_soundboards" ADD COLUMN "duration" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "room_soundboards" ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "room_soundboards" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;