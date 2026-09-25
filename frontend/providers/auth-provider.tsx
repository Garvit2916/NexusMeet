"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError } from "@/services/api";
import { authService, type Credentials, type Registration } from "@/services/auth-service";
import type { User } from "@/lib/types";

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  signIn: (credentials: Credentials) => Promise<User>;
  signUp: (registration: Registration) => Promise<User>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<User | null>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    try {
      const session = await authService.getSession();
      setUser(session);
      return session;
    } catch {
      setUser(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const signIn = useCallback(async (credentials: Credentials) => {
    setError(null);
    try {
      const signedInUser = await authService.signIn(credentials);
      setUser(signedInUser);
      return signedInUser;
    } catch (requestError) {
      const message = requestError instanceof ApiError ? requestError.message : "We could not sign you in. Please try again.";
      setError(message);
      throw requestError;
    }
  }, []);

  const signUp = useCallback(async (registration: Registration) => {
    setError(null);
    try {
      const registeredUser = await authService.register(registration);
      setUser(registeredUser);
      return registeredUser;
    } catch (requestError) {
      const message = requestError instanceof ApiError ? requestError.message : "We could not create your account. Please try again.";
      setError(message);
      throw requestError;
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    try {
      await authService.signOut();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isLoading, isAuthenticated: Boolean(user), error, signIn, signUp, signOut, refreshUser }),
    [user, isLoading, error, signIn, signUp, signOut, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
