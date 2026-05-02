import { useEffect, useState } from "react";
import { useLocation, useParams, Link } from "wouter";
import { useSocket } from "@/lib/socket-context";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ArrowLeft, QrCode, AlertCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export default function DeviceConnect() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { socket } = useSocket();
  const [, setLocation] = useLocation();
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("starting");
  const [error, setError] = useState<string | null>(null);

  const { data: device } = useQuery({
    queryKey: ["devices", sessionId],
    queryFn: async () => {
      const res = await fetch("/api/devices", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch device");
      const devices = await res.json();
      return devices.find((d: any) => d.sessionId === sessionId);
    },
  });

  useEffect(() => {
    if (!socket || !sessionId) return;

    socket.emit("subscribe-device", sessionId);

    socket.on("qr", (data: { sessionId: string; qr: string }) => {
      if (data.sessionId === sessionId) {
        setQrCode(data.qr);
        setStatus("qr");
      }
    });

    socket.on("status", (data: { sessionId: string; status: string; error?: string }) => {
      if (data.sessionId === sessionId) {
        setStatus(data.status);
        if (data.error) setError(data.error);
        
        if (data.status === "ready") {
          setTimeout(() => {
            setLocation(`/devices/${sessionId}`);
          }, 1000);
        }
      }
    });

    return () => {
      socket.off("qr");
      socket.off("status");
    };
  }, [socket, sessionId, setLocation]);

  return (
    <Layout>
      <div className="flex-1 flex flex-col items-center justify-center bg-[#f0f2f5] p-4 relative">
        <Button variant="ghost" size="sm" asChild className="absolute top-6 left-6 text-muted-foreground">
          <Link href="/devices">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Devices
          </Link>
        </Button>

        <Card className="max-w-3xl w-full grid md:grid-cols-2 overflow-hidden shadow-2xl border-none">
          <div className="p-10 flex flex-col justify-center bg-white">
            <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-6">
              <QrCode className="w-6 h-6 text-primary" />
            </div>
            <CardTitle className="text-2xl font-light mb-4 text-[#41525d]">
              To use WhatsApp on your computer:
            </CardTitle>
            <ol className="space-y-4 text-[#3b4a54] text-lg mb-8 list-decimal pl-5">
              <li>Open WhatsApp on your phone</li>
              <li>Tap <strong>Menu</strong> or <strong>Settings</strong> and select <strong>Linked Devices</strong></li>
              <li>Tap on <strong>Link a device</strong></li>
              <li>Point your phone to this screen to capture the code</li>
            </ol>
            
            {device && (
              <div className="mt-auto pt-6 border-t border-border/50 text-sm text-muted-foreground flex items-center justify-between">
                <span>Device: <strong className="text-foreground">{device.name}</strong></span>
                <span className="font-mono bg-muted px-2 py-0.5 rounded">{sessionId}</span>
              </div>
            )}
          </div>
          
          <div className="bg-[#f8f9fa] flex flex-col items-center justify-center p-10 min-h-[400px]">
            {status === "ready" ? (
              <div className="text-center animate-in fade-in zoom-in duration-500">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center text-white">
                    ✓
                  </div>
                </div>
                <h3 className="text-xl font-medium text-green-800">Ready!</h3>
                <p className="text-green-600/80 mt-2">Redirecting to chats...</p>
              </div>
            ) : status === "auth_failure" ? (
              <div className="text-center">
                <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
                <h3 className="text-xl font-medium text-red-800 mb-2">Authentication Failed</h3>
                <p className="text-red-600/80 text-sm max-w-xs">{error || "Could not connect to WhatsApp"}</p>
                <Button className="mt-6" onClick={() => setLocation("/devices")}>
                  Return to Devices
                </Button>
              </div>
            ) : qrCode ? (
              <div className="bg-white p-4 rounded-xl shadow-sm border animate-in fade-in">
                <img src={qrCode} alt="WhatsApp QR Code" className="w-64 h-64 mx-auto" />
                <div className="mt-4 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Waiting for scan...
                </div>
              </div>
            ) : (
              <div className="text-center flex flex-col items-center">
                <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
                <p className="text-muted-foreground font-medium">Generating QR code...</p>
              </div>
            )}
          </div>
        </Card>
      </div>
    </Layout>
  );
}
