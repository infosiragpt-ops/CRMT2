import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, MessageCircle, ShieldCheck, Sparkles, Users } from "lucide-react";

const PULPO_BUSINESS_APP_URL = "https://pulpo.chat/whatsapp-business-app?lang=es";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [, setLocation] = useLocation();
  const { refresh } = useAuth();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "include",
      });

      if (res.ok) {
        await refresh();
        setLocation("/");
      } else {
        let error = "No se pudo iniciar sesión.";
        try {
          const contentType = res.headers.get("content-type") ?? "";
          if (contentType.includes("application/json")) {
            const data = await res.json();
            error = typeof data?.error === "string" ? data.error : error;
          } else {
            const text = await res.text();
            error = res.status >= 500 ? "Error del servidor. Revisa los registros de la consola." : text || error;
          }
        } catch {
          error = res.status >= 500 ? "Error del servidor. Revisa los registros de la consola." : error;
        }
        toast({
          title: "No se pudo iniciar sesión",
          description: error,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error de red",
        description: "No se pudo conectar con el servidor.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-[100dvh] bg-muted/40 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100dvh-3rem)] w-full max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,440px)]">
        <section className="relative order-2 overflow-hidden rounded-2xl border border-emerald-200/70 bg-[linear-gradient(135deg,#ffffff_0%,#effcf6_50%,#edf4ff_100%)] p-6 shadow-xl shadow-slate-900/10 sm:p-8 lg:order-1 lg:p-10">
          <div className="relative z-10 flex h-full flex-col justify-between gap-8">
            <div className="space-y-6">
              <a
                href={PULPO_BUSINESS_APP_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-3 py-1.5 text-sm font-medium text-emerald-700 shadow-sm transition hover:border-emerald-300 hover:bg-white"
              >
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                pulpo.chat
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>

              <div className="max-w-xl space-y-4">
                <p className="text-sm font-semibold uppercase text-emerald-700">
                  Compatible con WhatsApp Business App
                </p>
                <h1 className="text-4xl font-bold leading-tight text-slate-950 sm:text-5xl">
                  Haz tu WhatsApp profesional
                </h1>
                <p className="text-base leading-7 text-slate-600 sm:text-lg">
                  Mantén tu número, tus chats y tu app. Migra en minutos y potencia a tu equipo con whatsap web Enterprise.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-white/80 bg-white/75 p-4 shadow-sm">
                  <Users className="mb-3 h-5 w-5 text-emerald-600" aria-hidden="true" />
                  <p className="text-sm font-semibold text-slate-950">Multiagente</p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">Tu equipo responde desde un solo número.</p>
                </div>
                <div className="rounded-xl border border-white/80 bg-white/75 p-4 shadow-sm">
                  <Sparkles className="mb-3 h-5 w-5 text-blue-600" aria-hidden="true" />
                  <p className="text-sm font-semibold text-slate-950">IA y flujos</p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">Automatiza conversaciones sin código.</p>
                </div>
                <div className="rounded-xl border border-white/80 bg-white/75 p-4 shadow-sm">
                  <ShieldCheck className="mb-3 h-5 w-5 text-slate-700" aria-hidden="true" />
                  <p className="text-sm font-semibold text-slate-950">API oficial</p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">Seguro y respaldado por Meta.</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-lg">
              <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <span className="ml-auto text-xs font-medium text-slate-500">PulpoChat CRM</span>
              </div>
              <div className="space-y-3">
                <div className="ml-auto max-w-[82%] rounded-2xl rounded-br-sm bg-emerald-500 px-4 py-3 text-sm font-medium text-white">
                  Hola, quiero mejorar la atención por WhatsApp.
                </div>
                <div className="max-w-[86%] rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-3 text-sm text-slate-700">
                  Perfecto. Podemos ayudarte con agentes, automatizaciones y CRM en una sola consola.
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                    Mismo número
                  </span>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                    5 minutos
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                    400+ integraciones
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="order-1 flex flex-col items-center gap-4 lg:order-2 lg:items-end" aria-label="Inicio de sesión">
          <Card className="w-full max-w-md border-border/50 shadow-xl">
            <CardHeader className="space-y-2 text-center">
              <CardTitle className="text-3xl font-bold tracking-tight">Bienvenido de nuevo</CardTitle>
              <CardDescription>Ingresa tus credenciales para acceder a tu consola</CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Usuario</Label>
                  <Input
                    id="username"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    className="bg-background"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Contraseña</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="bg-background"
                  />
                </div>
              </CardContent>
              <CardFooter className="flex flex-col space-y-4">
                <Button type="submit" className="w-full font-medium" disabled={isSubmitting}>
                  {isSubmitting ? "Iniciando sesión..." : "Iniciar sesión"}
                </Button>
              </CardFooter>
            </form>
          </Card>

          <div className="w-full max-w-md rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 text-center text-emerald-700 shadow-sm">
            <p className="text-lg font-bold">WhatsApp Web para empresas</p>
            <p className="mt-2 text-sm font-medium">
              Mensajes ilimitados y colaboradores ilimitados
            </p>
            <p className="mt-1 text-sm font-semibold">20 dólares al mes.</p>
            <a
              href="tel:+51918714054"
              className="mt-3 inline-flex text-sm font-bold text-emerald-700 hover:underline"
            >
              Contactar ventas: +51918714054
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
