import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Trash2, Check, Pencil } from "lucide-react";
import { toast } from "sonner";

type Label = { id: number; name: string; color: string };

const PALETTE = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e",
  "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1",
  "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#f43f5e", "#78716c",
  "#6b7280", "#0f172a",
];

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  if (!res.ok) throw new Error((await res.text().catch(() => "")) || res.statusText);
  return res.json() as Promise<T>;
}

export default function LabelsPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[10]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

  const { data: labels = [] } = useQuery<Label[]>({
    queryKey: ["labels"],
    queryFn: () => api<Label[]>("/api/labels"),
  });

  const create = useMutation({
    mutationFn: () =>
      api<Label>("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color }),
      }),
    onSuccess: () => {
      setName("");
      toast.success("Etiqueta creada");
      void qc.invalidateQueries({ queryKey: ["labels"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const update = useMutation({
    mutationFn: (id: number) =>
      api<Label>(`/api/labels/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, color: editColor }),
      }),
    onSuccess: () => {
      setEditingId(null);
      void qc.invalidateQueries({ queryKey: ["labels"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const del = useMutation({
    mutationFn: (id: number) => api(`/api/labels/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["labels"] }),
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <div className="min-h-screen bg-[#f0f2f5]">
      <header className="bg-[#202c33] text-white px-6 py-4 flex items-center gap-3">
        <Link href="/devices" className="p-1 hover:bg-white/10 rounded">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-lg font-semibold">Etiquetas</h1>
        <span className="ml-auto text-sm text-white/70">{labels.length} / 20</span>
      </header>

      <div className="max-w-3xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
          <div className="text-sm font-medium mb-2">Nueva etiqueta</div>
          <div className="flex gap-2 items-start">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre (ej. Clientes VIP)"
              maxLength={40}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim() && labels.length < 20) {
                  create.mutate();
                }
              }}
              className="flex-1"
            />
            <Button
              onClick={() => create.mutate()}
              disabled={!name.trim() || labels.length >= 20 || create.isPending}
            >
              Crear
            </Button>
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`w-8 h-8 rounded-full border-2 transition-transform ${
                  color === c ? "border-black scale-110" : "border-white"
                }`}
                style={{ backgroundColor: c }}
                aria-label={c}
              />
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm divide-y">
          {labels.length === 0 && (
            <div className="p-8 text-center text-muted-foreground">Sin etiquetas todavía.</div>
          )}
          {labels.map((l) => (
            <div key={l.id} className="flex items-center gap-3 p-3">
              {editingId === l.id ? (
                <>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="flex-1"
                  />
                  <div className="flex gap-1 flex-wrap max-w-[280px]">
                    {PALETTE.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setEditColor(c)}
                        className={`w-6 h-6 rounded-full border-2 ${
                          editColor === c ? "border-black" : "border-white"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <Button size="icon" onClick={() => update.mutate(l.id)}>
                    <Check className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setEditingId(null)}>
                    ✕
                  </Button>
                </>
              ) : (
                <>
                  <span
                    className="w-5 h-5 rounded-full shrink-0"
                    style={{ backgroundColor: l.color }}
                  />
                  <span className="flex-1 font-medium">{l.name}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      setEditingId(l.id);
                      setEditName(l.name);
                      setEditColor(l.color);
                    }}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-red-600 hover:text-red-700"
                    onClick={() => {
                      if (confirm(`Eliminar etiqueta "${l.name}"?`)) del.mutate(l.id);
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
