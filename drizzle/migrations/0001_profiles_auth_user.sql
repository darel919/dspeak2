ALTER TABLE "profiles" DROP CONSTRAINT IF EXISTS "profiles_id_users_id_fk";
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_auth_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;
