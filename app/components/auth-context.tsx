"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@/lib/session-payload";
import { SIGN_IN_CHANNEL } from "./google-sign-in";

type SignedInSession = Extract<Session, { authenticated: true }>;

interface AuthContextType {
  session: Session | null;
  setSession: React.Dispatch<React.SetStateAction<Session | null>>;
  refreshSession: () => Promise<Session | null>;
  updateSession: (updater: (prev: SignedInSession) => SignedInSession) => void;
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toggleSidebar: () => void;
  closeSidebar: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({
  initialSession,
  children,
}: {
  initialSession: Session | null;
  children: ReactNode;
}) {
  const [session, setSession] = useState<Session | null>(initialSession);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== "undefined" && window.innerWidth >= 1200) {
      try {
        const saved = localStorage.getItem("excela_sidebar_open");
        if (saved !== null) return saved === "true";
        return true;
      } catch {
        return true;
      }
    }
    return false;
  });

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      if (typeof window !== "undefined" && window.innerWidth >= 1024) {
        try {
          localStorage.setItem("excela_sidebar_open", String(next));
        } catch {
          // ignore
        }
      }
      return next;
    });
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch("/api/google/status", {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      const data: Session = await res.json();
      if (res.ok) {
        setSession(data);
        return data;
      }
    } catch {
      // best-effort
    }
    return null;
  }, []);

  const updateSession = useCallback(
    (updater: (prev: SignedInSession) => SignedInSession) => {
      setSession((curr) => {
        if (!curr || !curr.authenticated) return curr;
        return updater(curr);
      });
    },
    [],
  );

  // Quiet background session sync on mount
  useEffect(() => {
    if (!initialSession?.authenticated && initialSession !== null) return;
    let active = true;
    async function load() {
      try {
        const res = await fetch("/api/google/status", {
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        });
        const data: Session = await res.json();
        if (active && res.ok) {
          setSession(data);
        }
      } catch {
        // ignore background refresh failures
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [initialSession]);

  // Listen for Google OAuth completion across tabs/popups
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(SIGN_IN_CHANNEL);
    channel.onmessage = async (event: MessageEvent<{ status?: string }>) => {
      if (event.data?.status === "connected") {
        void refreshSession();
      }
    };
    return () => channel.close();
  }, [refreshSession]);

  return (
    <AuthContext.Provider
      value={{
        session,
        setSession,
        refreshSession,
        updateSession,
        sidebarOpen,
        setSidebarOpen,
        toggleSidebar,
        closeSidebar,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
