CREATE INDEX "bookmarks_user_created" ON "bookmarks" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "channels_room_position" ON "channels" USING btree ("room_id","position");--> statement-breakpoint
CREATE INDEX "chat_files_message" ON "chat_files" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "chat_files_channel_created" ON "chat_files" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_channel_created" ON "messages" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_reply_created" ON "messages" USING btree ("reply_to_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_created" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_read_created" ON "notifications" USING btree ("user_id","read","created_at");--> statement-breakpoint
CREATE INDEX "pinned_messages_channel_created" ON "pinned_messages" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "room_audit_log_room_created" ON "room_audit_log" USING btree ("room_id","created_at");--> statement-breakpoint
CREATE INDEX "room_images_room_type_created" ON "room_images" USING btree ("room_id","type","created_at");--> statement-breakpoint
CREATE INDEX "room_memberships_user_room" ON "room_memberships" USING btree ("user_id","room_id");--> statement-breakpoint
CREATE INDEX "room_roles_room_position" ON "room_roles" USING btree ("room_id","position");--> statement-breakpoint
CREATE INDEX "user_presence_status_updated" ON "user_presence" USING btree ("status","updated_at");