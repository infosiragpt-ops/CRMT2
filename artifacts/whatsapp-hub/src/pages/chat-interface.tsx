import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useSocket } from "@/lib/socket-context";
import { useAuth } from "@/lib/auth-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Send, User, Users, Smartphone, MessageSquare, Menu, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Chat = {
  id: string;
  name: string;
  isGroup: boolean;
  unreadCount: number;
  timestamp: number;
  lastMessage: string | null;
};

type Message = {
  id: string;
  chatId: string;
  from: string;
  to: string;
  body: string;
  fromMe: boolean;
  timestamp: number;
  hasMedia: boolean;
  type: string;
  author?: string;
};

export default function ChatInterface() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const { socket } = useSocket();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch all devices for the left rail
  const { data: devices } = useQuery({
    queryKey: ["devices"],
    queryFn: async () => {
      const res = await fetch("/api/devices", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch devices");
      return res.json();
    },
  });

  // Fetch chats for the current device
  const { data: chats, isLoading: isChatsLoading } = useQuery<Chat[]>({
    queryKey: ["chats", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/devices/${sessionId}/chats`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch chats");
      return res.json();
    },
    enabled: !!sessionId,
  });

  // Fetch messages for active chat
  const { data: messages, isLoading: isMessagesLoading } = useQuery<Message[]>({
    queryKey: ["messages", sessionId, activeChatId],
    queryFn: async () => {
      const res = await fetch(`/api/devices/${sessionId}/chats/${encodeURIComponent(activeChatId!)}/messages?limit=100`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch messages");
      return res.json();
    },
    enabled: !!sessionId && !!activeChatId,
  });

  // Send message mutation
  const sendMessage = useMutation({
    mutationFn: async (body: string) => {
      const res = await fetch(`/api/devices/${sessionId}/chats/${encodeURIComponent(activeChatId!)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (newMsg) => {
      // Optimistically add message
      queryClient.setQueryData(["messages", sessionId, activeChatId], (old: Message[] = []) => {
        return [...old, newMsg];
      });
      setMessageInput("");
    },
  });

  // Socket setup
  useEffect(() => {
    if (!socket || !sessionId) return;

    socket.emit("subscribe-device", sessionId);

    const handleMessage = (data: { sessionId: string } & Message) => {
      if (data.sessionId === sessionId) {
        // If message belongs to active chat, append it
        if (data.chatId === activeChatId) {
          queryClient.setQueryData(["messages", sessionId, activeChatId], (old: Message[] = []) => {
            // Avoid duplicates
            if (old.some(m => m.id === data.id)) return old;
            return [...old, data];
          });
        }
        
        // Update chats list with new lastMessage
        queryClient.setQueryData(["chats", sessionId], (old: Chat[] = []) => {
          const chatIndex = old.findIndex(c => c.id === data.chatId);
          if (chatIndex >= 0) {
            const newChats = [...old];
            const chat = newChats[chatIndex];
            newChats[chatIndex] = {
              ...chat,
              lastMessage: data.body,
              timestamp: data.timestamp,
              unreadCount: chat.id === activeChatId ? 0 : chat.unreadCount + 1
            };
            // Move to top
            const [moved] = newChats.splice(chatIndex, 1);
            newChats.unshift(moved);
            return newChats;
          }
          return old;
        });
      }
    };

    socket.on("message", handleMessage);

    return () => {
      socket.off("message", handleMessage);
    };
  }, [socket, sessionId, activeChatId, queryClient]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageInput.trim() || !activeChatId) return;
    sendMessage.mutate(messageInput.trim());
  };

  const filteredChats = chats?.filter(chat => 
    chat.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeChat = chats?.find(c => c.id === activeChatId);

  return (
    <div className="flex h-[100dvh] w-full bg-background overflow-hidden">
      
      {/* Left Rail - Device Switcher */}
      <div className="w-[72px] bg-[#202c33] flex flex-col items-center py-4 border-r border-white/10 shrink-0 z-20">
        <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center mb-6 shadow-lg">
          <MessageSquare className="w-6 h-6 text-white" />
        </div>
        
        <div className="flex-1 flex flex-col gap-4 w-full px-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link href="/devices" className="w-12 h-12 rounded-xl flex items-center justify-center text-white/60 hover:text-white hover:bg-white/5 transition-colors">
                <Menu className="w-6 h-6" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">All Devices</TooltipContent>
          </Tooltip>
          
          <div className="w-8 h-px bg-white/10 mx-auto my-2" />
          
          <ScrollArea className="flex-1 w-full">
            <div className="flex flex-col gap-3 items-center">
              {devices?.map((dev: any) => (
                <Tooltip key={dev.id}>
                  <TooltipTrigger asChild>
                    <Link href={`/devices/${dev.sessionId}`}>
                      <button className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${
                        dev.sessionId === sessionId 
                          ? "bg-white/20 text-white shadow-inner" 
                          : "text-white/60 hover:text-white hover:bg-white/10"
                      }`}>
                        <Smartphone className="w-6 h-6" />
                      </button>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">{dev.name}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </ScrollArea>
        </div>
        
        <div className="mt-auto pt-4">
          <Avatar className="w-10 h-10 border border-white/20">
            <AvatarFallback className="bg-[#111b21] text-white">
              {user?.displayName.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>
      </div>

      {/* Middle Pane - Chats List */}
      <div className="w-full max-w-[400px] flex flex-col bg-white border-r border-border shrink-0 z-10 shadow-[2px_0_10px_rgba(0,0,0,0.02)]">
        <div className="h-16 bg-[#f0f2f5] flex items-center px-4 shrink-0 justify-between">
          <h2 className="font-semibold text-[#41525d] text-lg">Chats</h2>
        </div>
        
        <div className="p-2 bg-white">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input 
              placeholder="Search or start new chat" 
              className="pl-9 bg-[#f0f2f5] border-none rounded-lg h-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        
        <ScrollArea className="flex-1">
          {isChatsLoading ? (
            <div className="p-4 space-y-4">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="flex gap-3 items-center">
                  <div className="w-12 h-12 rounded-full bg-muted animate-pulse shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded animate-pulse w-1/2" />
                    <div className="h-3 bg-muted rounded animate-pulse w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredChats?.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No chats found.
            </div>
          ) : (
            <div className="flex flex-col">
              {filteredChats?.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => setActiveChatId(chat.id)}
                  className={`flex items-center gap-3 px-4 py-3 hover:bg-[#f5f6f6] transition-colors text-left border-b border-border/40 ${
                    activeChatId === chat.id ? "bg-[#f0f2f5]" : ""
                  }`}
                >
                  <Avatar className="w-12 h-12 shrink-0">
                    <AvatarFallback className={chat.isGroup ? "bg-slate-200 text-slate-600" : "bg-primary/10 text-primary"}>
                      {chat.isGroup ? <Users className="w-6 h-6" /> : <User className="w-6 h-6" />}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 overflow-hidden">
                    <div className="flex justify-between items-baseline mb-0.5">
                      <span className="font-medium truncate text-[#111b21]">{chat.name}</span>
                      <span className={`text-xs shrink-0 ml-2 ${chat.unreadCount > 0 ? "text-[#25d366] font-medium" : "text-muted-foreground"}`}>
                        {chat.timestamp ? format(new Date(chat.timestamp * 1000), "HH:mm") : ""}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground truncate w-[90%]">
                        {chat.lastMessage || "No messages"}
                      </span>
                      {chat.unreadCount > 0 && (
                        <span className="bg-[#25d366] text-white text-xs rounded-full min-w-[20px] h-5 flex items-center justify-center px-1">
                          {chat.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right Pane - Active Chat */}
      <div className="flex-1 flex flex-col bg-[#efeae2] relative relative before:absolute before:inset-0 before:bg-[url('https://i.ibb.co/30B3v58/wa-bg.png')] before:opacity-40 before:pointer-events-none before:bg-repeat">
        {!activeChatId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 z-10 relative">
            <div className="w-[320px] h-[320px] bg-white rounded-full flex items-center justify-center mb-8 shadow-xl">
              <MessageSquare className="w-32 h-32 text-primary/20" />
            </div>
            <h2 className="text-3xl font-light text-[#41525d] mb-4">WhatsApp Hub</h2>
            <p className="text-[#667781] max-w-md">
              Send and receive messages without keeping your phone online.
              Select a chat from the sidebar to start messaging.
            </p>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <div className="h-16 bg-[#f0f2f5] flex items-center px-4 z-10 shrink-0 shadow-sm border-l border-border/50">
              <Avatar className="w-10 h-10 mr-3">
                <AvatarFallback className={activeChat?.isGroup ? "bg-slate-200" : "bg-primary/10"}>
                  {activeChat?.isGroup ? <Users className="w-5 h-5 text-slate-600" /> : <User className="w-5 h-5 text-primary" />}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 overflow-hidden">
                <h2 className="font-medium text-[#111b21] truncate">{activeChat?.name}</h2>
              </div>
            </div>

            {/* Messages Area */}
            <ScrollArea className="flex-1 p-4 z-10">
              <div className="flex flex-col gap-2 max-w-4xl mx-auto pb-4">
                {isMessagesLoading ? (
                  <div className="flex justify-center p-4">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : messages?.length === 0 ? (
                  <div className="bg-yellow-100/80 text-yellow-800 text-xs px-4 py-2 rounded-lg text-center self-center my-4">
                    Send a message to start this chat.
                  </div>
                ) : (
                  messages?.map((msg) => (
                    <div 
                      key={msg.id} 
                      className={`flex flex-col max-w-[75%] ${msg.fromMe ? "self-end" : "self-start"}`}
                    >
                      <div className={`
                        px-3 py-2 rounded-lg relative shadow-sm text-sm
                        ${msg.fromMe 
                          ? "bg-[#d9fdd3] text-[#111b21] rounded-tr-none" 
                          : "bg-white text-[#111b21] rounded-tl-none"
                        }
                      `}>
                        {/* Group author name */}
                        {!msg.fromMe && activeChat?.isGroup && msg.author && (
                          <div className="text-xs font-semibold text-primary mb-1">
                            {msg.author.split('@')[0]}
                          </div>
                        )}
                        
                        <div className="break-words whitespace-pre-wrap">{msg.body}</div>
                        
                        <div className="text-[10px] text-black/40 text-right mt-1 ml-4 inline-block float-right h-[15px]">
                          {format(new Date(msg.timestamp * 1000), "HH:mm")}
                        </div>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Input Area */}
            <div className="bg-[#f0f2f5] p-3 z-10 shrink-0">
              <form onSubmit={handleSend} className="max-w-4xl mx-auto flex items-end gap-2">
                <div className="flex-1 bg-white rounded-xl border-none shadow-sm flex items-center min-h-[44px] px-4 py-2 focus-within:ring-1 focus-within:ring-primary/50 transition-shadow">
                  <textarea 
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend(e);
                      }
                    }}
                    placeholder="Type a message" 
                    className="w-full bg-transparent border-none outline-none resize-none max-h-32 min-h-[24px] py-0 text-[#111b21] text-sm"
                    rows={1}
                  />
                </div>
                <Button 
                  type="submit" 
                  size="icon" 
                  disabled={!messageInput.trim() || sendMessage.isPending}
                  className="w-11 h-11 rounded-full shrink-0 bg-primary hover:bg-primary/90 text-white"
                >
                  <Send className="w-5 h-5 ml-1" />
                </Button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
