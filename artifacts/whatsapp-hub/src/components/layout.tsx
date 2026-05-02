import { Link } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { LogOut, MonitorSmartphone } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
      <header className="h-14 border-b border-border flex items-center justify-between px-6 bg-card shrink-0 shadow-xs z-10">
        <Link href="/devices" className="flex items-center gap-2 text-primary font-bold tracking-tight">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <MonitorSmartphone className="w-5 h-5" />
          </div>
          <span>WhatsApp Hub</span>
        </Link>

        {user && (
          <div className="flex items-center gap-4">
            <div className="text-sm font-medium text-muted-foreground">
              {user.displayName}
            </div>
            <Button variant="ghost" size="icon" onClick={logout} className="text-muted-foreground hover:text-foreground">
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        )}
      </header>
      <main className="flex-1 flex flex-col relative">
        {children}
      </main>
    </div>
  );
}
