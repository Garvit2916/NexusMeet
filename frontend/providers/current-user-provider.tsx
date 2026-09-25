"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_USER_EMAIL, DEFAULT_USER_ID, DEFAULT_USER_NAME } from "@/lib/constants";
import { currentUserService } from "@/services/user-service";
import type { User } from "@/lib/types";

type CurrentUserContextValue = {
  user: User;
  isLoading: boolean;
  error: string | null;
  updateUser: (changes: Partial<User>) => void;
};

const CurrentUserContext = createContext<CurrentUserContextValue | null>(null);
const initialUser: User = {
  id: DEFAULT_USER_ID,
  name: DEFAULT_USER_NAME,
  email: DEFAULT_USER_EMAIL,
  initials: "DU",
  role: "host",
};

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User>(initialUser);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    currentUserService
      .getCurrentUser()
      .then((nextUser) => {
        if (active) setUser(nextUser);
      })
      .catch(() => {
        if (active) setError("Unable to connect to the server. Some profile details may be unavailable.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const updateUser = (changes: Partial<User>) => setUser((current) => ({ ...current, ...changes }));
  const value = useMemo(() => ({ user, isLoading, error, updateUser }), [user, isLoading, error]);
  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser() {
  const value = useContext(CurrentUserContext);
  if (!value) throw new Error("useCurrentUser must be used within CurrentUserProvider");
  return value;
}
