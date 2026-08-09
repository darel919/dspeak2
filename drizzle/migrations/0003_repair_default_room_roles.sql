UPDATE "room_roles"
SET "is_default" = true
WHERE "name" = 'Member'
  AND "system" = false
  AND "is_default" = false
  AND "permissions" = '[]'::jsonb;
