import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth } from "./auth-context";

type SocketContextType = {
  socket: Socket | null;
  connected: boolean;
};

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!user) {
      setSocket((current) => {
        current?.disconnect();
        return null;
      });
      setConnected(false);
      return undefined;
    }

    const newSocket = io({
      path: "/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"],
      rememberUpgrade: true,
      reconnectionDelay: 300,
      reconnectionDelayMax: 2_500,
      timeout: 5_000,
    });
    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);
    newSocket.on("connect", handleConnect);
    newSocket.on("disconnect", handleDisconnect);
    setSocket(newSocket);

    return () => {
      newSocket.off("connect", handleConnect);
      newSocket.off("disconnect", handleDisconnect);
      newSocket.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [user]);

  return (
    <SocketContext.Provider value={{ socket, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (context === undefined) {
    throw new Error("useSocket must be used within a SocketProvider");
  }
  return context;
}
