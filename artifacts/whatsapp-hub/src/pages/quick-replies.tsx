import { useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Trash2, Paperclip, X, Play, FileText } from "lucide-react";
import { toast } from "sonner";

type Attachment = {
  id: number;
  kind: "image" | "video" | "audio" | "document";
  fileName: string;
  mimeType: string;
  url: string;
};

type QuickReply = {
  id: number;
  shortcut: string;
  title: string;
  body: string;
  attachments: Attachment[];
};

async function jsonApi<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text || res.statusText;
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed.error === "string") message = parsed.error;
    } catch {
      if (/<html[\s>]/i.test(text) || /bad gateway/i.test(text)) {
        message = "Servidor no disponible. Intenta nuevamente en unos segundos.";
      }
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export default function QuickRepliesPage() {
  const qc = useQueryClient();
  const [shortcut, setShortcut] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: replies = [] } = useQuery<QuickReply[]>({
    queryKey: ["quick-replies"],
    queryFn: () => jsonApi<QuickReply[]>("/api/quick-replies"),
  });

  const create = useMutation({
    mutationFn: async () => {
      if (files.length === 0) {
        return jsonApi<QuickReply>("/api/quick-replies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shortcut, title, body }),
        });
      }
      const fd = new FormData();
      fd.append("shortcut", shortcut);
      fd.append("title", title);
      fd.append("body", body);
      for (const f of files) fd.append("attachments", f);
      return jsonApi<QuickReply>("/api/quick-replies", {
        method: "POST",
        body: fd,
      });
    },
    onSuccess: () => {
      toast.success("Respuesta rápida creada");
      setShortcut("");
      setTitle("");
      setBody("");
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      void qc.invalidateQueries({ queryKey: ["quick-replies"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const del = useMutation({
    mutationFn: (id: number) => jsonApi(`/api/quick-replies/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quick-replies"] }),
  });

  const delAttachment = useMutation({
    mutationFn: ({ id, attachmentId }: { id: number; attachmentId: number }) =>
      jsonApi(`/api/quick-replies/${id}/attachments/${attachmentId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quick-replies"] }),
  });

  return (
    <div className="min-h-screen bg-[#f0f2f5]">
      <header className="bg-[#202c33] text-white px-6 py-4 flex items-center gap-3">
        <Link href="/devices" className="p-1 hover:bg-white/10 rounded">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-lg font-semibold">Respuestas rápidas</h1>
        <span className="ml-auto text-sm text-white/70">{replies.length}</span>
      </header>

      <div className="max-w-3xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow-sm p-4 mb-4 space-y-3">
          <div className="text-sm font-medium">Nueva respuesta</div>
          <div className="flex gap-2">
            <Input
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value.replace(/\s+/g, ""))}
              placeholder="/atajo (sin espacios)"
              className="w-48"
              maxLength={40}
            />
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Título"
              className="flex-1"
              maxLength={80}
            />
          </div>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Texto del mensaje (opcional si adjuntas media)"
            rows={3}
            maxLength={4000}
          />
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="hidden"
              id="qr-files"
            />
            <label
              htmlFor="qr-files"
              className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 bg-[#f0f2f5] hover:bg-[#e4e6eb] rounded-md text-sm"
            >
              <Paperclip className="w-4 h-4" /> Adjuntar archivos
            </label>
            <span className="text-xs text-muted-foreground">
              {files.length
                ? `${files.length} archivo${files.length > 1 ? "s" : ""} listo${files.length > 1 ? "s" : ""}`
                : "Opcional"}
            </span>
            <Button
              className="ml-auto"
              disabled={!shortcut.trim() || create.isPending || (!body.trim() && files.length === 0)}
              onClick={() => create.mutate()}
            >
              Crear
            </Button>
          </div>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
              {files.map((f, i) => (
                <span key={i} className="bg-[#f0f2f5] px-2 py-1 rounded">
                  {f.name} ({Math.round(f.size / 1024)} KB)
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm divide-y">
          {replies.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">
              Sin respuestas rápidas todavía.
            </div>
          )}
          {replies.map((r) => (
            <div key={r.id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-primary">/{r.shortcut}</span>
                    <span className="font-medium">{r.title || "(sin título)"}</span>
                  </div>
                  {r.body && (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{r.body}</p>
                  )}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-red-600 hover:text-red-700"
                  onClick={() => {
                    if (confirm(`Eliminar "/${r.shortcut}"?`)) del.mutate(r.id);
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              {r.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {r.attachments.map((a) => (
                    <div key={a.id} className="relative group">
                      {a.kind === "image" ? (
                        <img
                          src={a.url}
                          alt={a.fileName}
                          className="w-20 h-20 object-cover rounded-md border"
                        />
                      ) : a.kind === "video" ? (
                        <div className="w-20 h-20 rounded-md border bg-black/90 flex items-center justify-center text-white">
                          <Play className="w-8 h-8" />
                        </div>
                      ) : a.kind === "audio" ? (
                        <div className="w-20 h-20 rounded-md border bg-[#f0f2f5] flex flex-col items-center justify-center gap-1 text-xs text-center p-1">
                          <Paperclip className="w-5 h-5 text-[#667781]" />
                          Audio
                        </div>
                      ) : (
                        <div className="w-20 h-20 rounded-md border bg-[#f0f2f5] flex flex-col items-center justify-center gap-1 text-xs text-center p-1">
                          <FileText className="w-5 h-5 text-[#667781]" />
                          <span className="line-clamp-2 break-all">{a.fileName}</span>
                        </div>
                      )}
                      <button
                        type="button"
                        className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                        onClick={() =>
                          delAttachment.mutate({ id: r.id, attachmentId: a.id })
                        }
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
