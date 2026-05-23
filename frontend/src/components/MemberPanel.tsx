import { useState } from "react";
import type { Member } from "@/types";
import { createMember, fetchMembers, reorderMembers, updateMember, deleteMember } from "@/api/members";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GripVertical, Plus, User } from "lucide-react";

interface MemberPanelProps {
  members: Member[];
  onMembersChange: (members: Member[]) => void;
  onClose: () => void;
}

interface MemberFormData {
  email: string;
  name: string;
  role: string;
  avatar_url: string;
}

const emptyForm: MemberFormData = { email: "", name: "", role: "", avatar_url: "" };

const avatarColors = ["bg-indigo-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500", "bg-rose-500", "bg-cyan-500"];

function getInitials(name: string): string {
  if (!name.trim()) return "?";
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export function MemberPanel({ members, onMembersChange, onClose }: MemberPanelProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<MemberFormData>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggedEmail, setDraggedEmail] = useState<string | null>(null);
  const [dragOverEmail, setDragOverEmail] = useState<string | null>(null);

  function startAdd() {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
    setError(null);
  }

  function startEdit(member: Member) {
    setEditing(member.email);
    setForm({ email: member.email, name: member.name, role: member.role, avatar_url: member.avatar_url });
    setShowForm(true);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.email || !form.name) {
      setError("Email and name are required");
      return;
    }
    try {
      if (editing) {
        const updated = await updateMember(editing, form);
        onMembersChange(members.map((m) => (m.email === editing ? updated : m)));
      } else {
        const created = await createMember(form);
        onMembersChange([...members, created]);
      }
      setShowForm(false);
      setForm(emptyForm);
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed");
    }
  }

  async function handleDelete(email: string) {
    try {
      await deleteMember(email);
      onMembersChange(members.filter((m) => m.email !== email));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function handleDragStart(e: React.DragEvent, email: string) {
    setDraggedEmail(email);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", email);
  }

  function handleDragOver(e: React.DragEvent, email: string) {
    if (!draggedEmail) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (email !== dragOverEmail) setDragOverEmail(email);
  }

  function handleDragLeave(email: string) {
    if (dragOverEmail === email) setDragOverEmail(null);
  }

  async function handleDrop(e: React.DragEvent, targetEmail: string) {
    e.preventDefault();
    const dragged = draggedEmail;
    setDraggedEmail(null);
    setDragOverEmail(null);
    if (!dragged || dragged === targetEmail) return;

    const fromIdx = members.findIndex((m) => m.email === dragged);
    const toIdx = members.findIndex((m) => m.email === targetEmail);
    if (fromIdx === -1 || toIdx === -1) return;

    const next = [...members];
    const [moved] = next.splice(fromIdx, 1);
    if (!moved) return;
    next.splice(toIdx, 0, moved);
    const reseq = next.map((m, i) => ({ ...m, seq: i + 1 }));

    const previous = members;
    onMembersChange(reseq);
    try {
      await reorderMembers(reseq.map((m) => ({ email: m.email, seq: m.seq })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reorder failed");
      onMembersChange(previous);
      fetchMembers().then(onMembersChange).catch(() => {});
    }
  }

  function handleDragEnd() {
    setDraggedEmail(null);
    setDragOverEmail(null);
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" style={{ maxWidth: 420 }}>
        <SheetHeader>
          <SheetTitle>Team Members</SheetTitle>
          <SheetDescription>{members.length} members</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 space-y-2">
          {error && (
            <div className="bg-destructive/10 text-destructive text-[12px] px-3 py-2 rounded-lg">{error}</div>
          )}

          {members.map((member, idx) => {
            const isDragging = draggedEmail === member.email;
            const isDragOver = dragOverEmail === member.email && draggedEmail !== member.email;
            return (
              <div
                key={member.email}
                draggable
                onDragStart={(e) => handleDragStart(e, member.email)}
                onDragOver={(e) => handleDragOver(e, member.email)}
                onDragLeave={() => handleDragLeave(member.email)}
                onDrop={(e) => handleDrop(e, member.email)}
                onDragEnd={handleDragEnd}
                className={`group flex items-center justify-between p-3 rounded-xl border hover:shadow-sm transition-all ${isDragging ? "opacity-40" : ""} ${isDragOver ? "border-indigo-300 bg-indigo-50/60" : ""}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="flex items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground flex-shrink-0"
                    title="Drag to reorder"
                  >
                    <GripVertical className="size-4" />
                  </div>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-[13px] font-bold leading-none flex-shrink-0 shadow-sm ${avatarColors[idx % avatarColors.length]}`}>
                    {getInitials(member.name)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium truncate">{member.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{member.email}</div>
                    {member.role && <div className="text-[11px] text-muted-foreground">{member.role}</div>}
                  </div>
                </div>
                <div className="flex gap-1 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="xs" onClick={() => startEdit(member)}>Edit</Button>
                  <Button variant="destructive" size="xs" onClick={() => handleDelete(member.email)}>Delete</Button>
                </div>
              </div>
            );
          })}

          {members.length === 0 && !showForm && (
            <div className="text-center py-12">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
                <User className="size-6 text-muted-foreground" />
              </div>
              <p className="text-[13px] text-muted-foreground font-medium">No members yet</p>
              <p className="text-[11px] text-muted-foreground mt-1">Add your first team member to get started.</p>
            </div>
          )}
        </div>

        {showForm ? (
          <form onSubmit={handleSubmit} className="border-t p-4 space-y-3">
            <p className="text-[13px] font-semibold">{editing ? "Edit Member" : "Add Member"}</p>
            <Input type="email" placeholder="Email" className="h-8 !text-[12px]" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!!editing} />
            <Input placeholder="Name" className="h-8 !text-[12px]" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="Role" className="h-8 !text-[12px]" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
            <div className="flex gap-2 pt-1">
              <Button type="submit" size="sm" className="flex-1">{editing ? "Update" : "Add Member"}</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Button>
            </div>
          </form>
        ) : (
          <SheetFooter>
            <Button onClick={startAdd} size="sm" className="w-full">
              <Plus />
              Add Member
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
