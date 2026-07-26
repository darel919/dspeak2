import { sameOriginAvatarPath } from "../../shared/avatar-path.js";
import { publicDisplayName } from "../../shared/user-profile.js";

export function mediaUserProfile(user) {
  const id = String(user.id);
  return {
    id,
    name: publicDisplayName(user),
    username: user.username || "",
    handle: user.handle || "",
    display_name: user.display_name || "",
    avatar: sameOriginAvatarPath({ id, avatar: user.avatar }),
  };
}
