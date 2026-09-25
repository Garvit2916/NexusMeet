import type { ApiUser } from "@/lib/api-types";
import { apiRequest } from "./api";
import type { User } from "@/lib/types";

function initialsFor(name: string) {
  const pieces = name.split(" ").filter(Boolean);
  if (!pieces.length) return "?";
  if (pieces.length === 1) return pieces[0].slice(0, 2).toUpperCase();
  return `${pieces[0][0]}${pieces.at(-1)?.[0] ?? ""}`.toUpperCase();
}

function normalizeUser(raw: ApiUser): User {
  return {
    id: raw.id,
    name: raw.name,
    email: raw.email,
    initials: raw.initials || initialsFor(raw.name),
    role: raw.role || "host",
    avatarUrl: raw.avatar_url ?? raw.avatarUrl ?? undefined,
  };
}

export const currentUserService = {
  async getCurrentUser(): Promise<User> {
    return normalizeUser(await apiRequest<ApiUser>("/users/me"));
  },
};
