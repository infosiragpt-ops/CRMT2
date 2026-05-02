import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { SocketProvider } from "@/lib/socket-context";

// Pages
import Login from "@/pages/login";
import Register from "@/pages/register";
import Devices from "@/pages/devices";
import DeviceConnect from "@/pages/device-connect";
import ChatInterface from "@/pages/chat-interface";
import LabelsPage from "@/pages/labels";
import QuickRepliesPage from "@/pages/quick-replies";
import NotFound from "@/pages/not-found";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

const queryClient = new QueryClient();

type LandingUser = {
  role: "admin" | "user";
};

type LandingDevice = {
  sessionId?: string;
  status?: string;
  liveStatus?: string;
};

async function resolveLandingPath(user: LandingUser) {
  if (user.role === "admin") return "/devices";

  try {
    const res = await fetch("/api/devices", { credentials: "include" });
    if (!res.ok) return "/devices";
    const devices = (await res.json()) as LandingDevice[];
    const target =
      devices.find((device) => (device.liveStatus ?? device.status) === "ready") ?? devices[0];
    return target?.sessionId ? `/devices/${target.sessionId}` : "/devices";
  } catch {
    return "/devices";
  }
}

// Route guard component
function ProtectedRoute({ component: Component }: { component: React.ComponentType<any> }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/login");
    }
  }, [user, isLoading, setLocation]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  return <Component />;
}

// Auth guard component (redirects away from login if already authed)
function AuthRoute({ component: Component }: { component: React.ComponentType<any> }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoading || !user) return;
    let cancelled = false;

    resolveLandingPath(user).then((path) => {
      if (!cancelled) setLocation(path);
    });

    return () => {
      cancelled = true;
    };
  }, [user, isLoading, setLocation]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (user) return null;

  return <Component />;
}

// Redirects root to /devices or /login based on auth
function RootRedirect() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      setLocation("/login");
      return;
    }

    let cancelled = false;
    resolveLandingPath(user).then((path) => {
      if (!cancelled) setLocation(path);
    });

    return () => {
      cancelled = true;
    };
  }, [user, isLoading, setLocation]);

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={RootRedirect} />
      <Route path="/login">
        {() => <AuthRoute component={Login} />}
      </Route>
      <Route path="/register">
        {() => <AuthRoute component={Register} />}
      </Route>
      <Route path="/devices">
        {() => <ProtectedRoute component={Devices} />}
      </Route>
      <Route path="/devices/:sessionId/connect">
        {() => <ProtectedRoute component={DeviceConnect} />}
      </Route>
      <Route path="/devices/:sessionId">
        {() => <ProtectedRoute component={ChatInterface} />}
      </Route>
      <Route path="/labels">
        {() => <ProtectedRoute component={LabelsPage} />}
      </Route>
      <Route path="/quick-replies">
        {() => <ProtectedRoute component={QuickRepliesPage} />}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <AuthProvider>
          <SocketProvider>
            <TooltipProvider>
              <AppRouter />
              <Toaster />
              <SonnerToaster
                position="top-right"
                richColors
                gap={6}
                visibleToasts={4}
                offset={{ top: 14, right: 14 }}
              />
            </TooltipProvider>
          </SocketProvider>
        </AuthProvider>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
