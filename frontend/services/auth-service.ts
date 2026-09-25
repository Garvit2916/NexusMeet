import type { ApiUser } from "@/lib/api-types";
import type { User } from "@/lib/types";
import { apiRequest, ApiError } from "./api";

function initialsFor(name: string) {
  const pieces = name.split(" ").filter(Boolean);
  if (!pieces.length) return "?";
  if (pieces.length === 1) return pieces[0].slice(0, 2).toUpperCase();
  return `${pieces[0][0]}${pieces.at(-1)?.[0] ?? ""}`.toUpperCase();
}

export function normalizeUser(raw: ApiUser, fallbackRole: User["role"] = "attendee"): User {
  const name = raw.name.trim() || "Guest";
  return {
    id: raw.id,
    name,
    email: raw.email,
    initials: raw.initials || initialsFor(name),
    role: raw.role === "host" || raw.role === "presenter" ? raw.role : fallbackRole,
    avatarUrl: raw.avatar_url ?? raw.avatarUrl ?? undefined,
  };
}

export type Credentials = { email: string; password: string };

export type Registration = Credentials & { name: string };

export const authService = {
  async signIn(credentials: Credentials): Promise<User> {
    return normalizeUser(
      await apiRequest<ApiUser>("/auth/login", {
        method: "POST",
        body: JSON.stringify(credentials),
      }),
    );
  },

  async register(registration: Registration): Promise<User> {
    return normalizeUser(
      await apiRequest<ApiUser>("/auth/register", {
        method: "POST",
        body: JSON.stringify(registration),
      }),
    );
  },

  async getSession(): Promise<User | null> {
    try {
      return normalizeUser(await apiRequest<ApiUser>("/auth/me"));
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.code === "UNAUTHENTICATED")) {
        return null;
      }
      throw error;
    }
  },

  async signOut(): Promise<void> {
    await apiRequest<{ message: string }>("/auth/logout", { method: "POST" });
  },
};
