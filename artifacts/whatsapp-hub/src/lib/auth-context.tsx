import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { useLocation } from "wouter";

type User = {
  id: number;
  username: string;
  displayName: string;
  role: "admin" | "user";
  permissions?: CollaboratorPermissions;
};

type CollaboratorPermissions = {
  canReply: boolean;
  canSendMedia: boolean;
  canUseQuickReplies: boolean;
  canManageQuickReplies: boolean;
  canManageLabels: boolean;
  canManageChats: boolean;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [, setLocation] = useLocation();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      } else {
        setUser(null);
      }
    } catch (error) {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch (error) {
      console.error(error);
    }
    setUser(null);
    setLocation("/login");
  }, [setLocation]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, isLoading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
