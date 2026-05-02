import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Smartphone, Plus, Trash2, LogOut, Power, ArrowRight, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

type Device = {
  id: number;
  userId: number;
  name: string;
  sessionId: string;
  status: string;
  phoneNumber: string | null;
  profileName: string | null;
  lastConnectedAt: string | null;
  createdAt: string;
  liveStatus?: string;
};

export default function Devices() {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data: devices, isLoading } = useQuery<Device[]>({
    queryKey: ["devices"],
    queryFn: async () => {
      const res = await fetch("/api/devices", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch devices");
      return res.json();
    },
  });

  const addDevice = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      setIsAddOpen(false);
      setNewName("");
      toast({ title: "Device added successfully" });
    },
    onError: (error) => {
      toast({ title: "Failed to add device", description: error.message, variant: "destructive" });
    },
  });

  const startDevice = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`/api/devices/${sessionId}/start`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: (_, sessionId) => {
      setLocation(`/devices/${sessionId}/connect`);
    },
    onError: (error) => {
      toast({ title: "Failed to start device", description: error.message, variant: "destructive" });
    },
  });

  const logoutDevice = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`/api/devices/${sessionId}/logout`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast({ title: "Device disconnected" });
    },
    onError: (error) => {
      toast({ title: "Failed to logout device", description: error.message, variant: "destructive" });
    },
  });

  const deleteDevice = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`/api/devices/${sessionId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      toast({ title: "Device deleted" });
    },
    onError: (error) => {
      toast({ title: "Failed to delete device", description: error.message, variant: "destructive" });
    },
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    addDevice.mutate(newName.trim());
  };

  const collaboratorTarget =
    !isAdmin && devices
      ? devices.find((device) => (device.liveStatus ?? device.status) === "ready") ?? devices[0]
      : null;

  useEffect(() => {
    if (isLoading || isAdmin || !collaboratorTarget?.sessionId) return;
    setLocation(`/devices/${collaboratorTarget.sessionId}`);
  }, [collaboratorTarget?.sessionId, isAdmin, isLoading, setLocation]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ready":
        return <Badge variant="default" className="bg-green-500/10 text-green-700 hover:bg-green-500/20 border-green-500/20">Ready</Badge>;
      case "qr":
        return <Badge variant="secondary" className="bg-blue-500/10 text-blue-700 hover:bg-blue-500/20 border-blue-500/20">Scan QR</Badge>;
      case "starting":
      case "authenticated":
        return <Badge variant="secondary" className="bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 border-amber-500/20">Connecting</Badge>;
      case "auth_failure":
        return <Badge variant="destructive" className="bg-red-500/10 text-red-700 hover:bg-red-500/20 border-red-500/20">Auth Failed</Badge>;
      default:
        return <Badge variant="outline" className="text-muted-foreground">Disconnected</Badge>;
    }
  };

  return (
    <Layout>
      <div className="flex-1 overflow-auto bg-muted/20">
        <div className="max-w-6xl mx-auto p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Devices</h1>
              <p className="text-muted-foreground">Manage your connected WhatsApp accounts</p>
            </div>
            
            {isAdmin ? (
              <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Device
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <form onSubmit={handleAdd}>
                    <DialogHeader>
                      <DialogTitle>Add a new device</DialogTitle>
                      <DialogDescription>
                        Give this connection a friendly name to identify it later.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                      <Label htmlFor="name" className="mb-2 block">Device Name</Label>
                      <Input
                        id="name"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="e.g. Sales Team, Support Line..."
                        autoFocus
                      />
                    </div>
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={addDevice.isPending || !newName.trim()}>
                        {addDevice.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                        Create
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            ) : null}
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map(i => (
                <Card key={i} className="animate-pulse">
                  <CardHeader className="h-24 bg-muted/50" />
                  <CardContent className="h-32" />
                </Card>
              ))}
            </div>
          ) : !isAdmin && collaboratorTarget ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : devices?.length === 0 ? (
            <div className="text-center py-20 border-2 border-dashed rounded-xl bg-background">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                <Smartphone className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">
                {isAdmin ? "No devices yet" : "No devices available"}
              </h3>
              <p className="text-muted-foreground max-w-sm mx-auto mb-6">
                {isAdmin
                  ? "Add a device to connect to WhatsApp and start managing your conversations."
                  : "Ask an administrator to connect a WhatsApp device first."}
              </p>
              {isAdmin ? (
                <Button onClick={() => setIsAddOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add your first device
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {devices?.map((device) => {
                const status = device.liveStatus ?? device.status;
                return (
                  <Card key={device.id} className="flex flex-col border-border/50 shadow-sm hover:shadow-md transition-all group">
                    <CardHeader className="pb-3 border-b border-border/50 bg-muted/10">
                      <div className="flex justify-between items-start">
                        <div className="space-y-1">
                          <CardTitle className="flex items-center gap-2 text-lg">
                            <Smartphone className="w-5 h-5 text-primary" />
                            {device.name}
                          </CardTitle>
                          <div className="text-sm text-muted-foreground font-mono bg-background px-2 py-0.5 rounded-md inline-block border">
                            {device.sessionId}
                          </div>
                        </div>
                        {getStatusBadge(status)}
                      </div>
                    </CardHeader>
                    <CardContent className="py-4 flex-1">
                      <dl className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Phone</dt>
                          <dd className="font-medium">{device.phoneNumber || "—"}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Profile Name</dt>
                          <dd className="font-medium">{device.profileName || "—"}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Last Connected</dt>
                          <dd className="font-medium">
                            {device.lastConnectedAt ? format(new Date(device.lastConnectedAt), "MMM d, h:mm a") : "Never"}
                          </dd>
                        </div>
                      </dl>
                    </CardContent>
                    <CardFooter className="pt-3 border-t border-border/50 flex flex-wrap gap-2 justify-end bg-muted/10">
                      {status === "ready" ? (
                        <>
                          {isAdmin ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => logoutDevice.mutate(device.sessionId)}
                              disabled={logoutDevice.isPending}
                              className="bg-white hover:bg-muted"
                            >
                              <LogOut className="w-4 h-4 mr-2" />
                              Log out
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            asChild
                            className="bg-primary text-primary-foreground hover:bg-primary/90"
                          >
                            <Link href={`/devices/${device.sessionId}`}>
                              Open Chats
                              <ArrowRight className="w-4 h-4 ml-2" />
                            </Link>
                          </Button>
                        </>
                      ) : isAdmin ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteDevice.mutate(device.sessionId)}
                            disabled={deleteDevice.isPending}
                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                          {(() => {
                            const isThisStarting =
                              (startDevice.isPending && startDevice.variables === device.sessionId) ||
                              status === "starting";
                            return (
                              <Button
                                size="sm"
                                onClick={() => startDevice.mutate(device.sessionId)}
                                disabled={isThisStarting}
                                className="bg-primary text-primary-foreground hover:bg-primary/90"
                              >
                                {isThisStarting ? (
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                ) : (
                                  <Power className="w-4 h-4 mr-2" />
                                )}
                                Connect
                              </Button>
                            );
                          })()}
                        </>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Waiting for admin
                        </Badge>
                      )}
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
