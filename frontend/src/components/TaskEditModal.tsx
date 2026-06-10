import { useState } from "react";
import type { Member, TaskSetting, Deadline } from "@/types";
import { fetchTasks, upsertTask } from "@/api/tasks";
import { syncJira } from "@/api/jira";
import { devPointsToEffort, issueTypeBadgeStyle } from "@/lib/jira";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, RefreshCw, ExternalLink } from "lucide-react";

interface TaskEditModalProps {
  task: TaskSetting;
  members: Member[];
  deadlines: Deadline[];
  jiraBaseUrl?: string;
  onSave: (saved: TaskSetting, allTasks?: TaskSetting[]) => void;
  onClose: () => void;
}

const NONE = "__none__";

const priorityBadgeClass: Record<string, string> = {
  Highest: "bg-red-50 text-red-700 border-red-100",
  High: "bg-orange-50 text-orange-700 border-orange-100",
  Medium: "bg-yellow-50 text-yellow-700 border-yellow-100",
  Low: "bg-blue-50 text-blue-700 border-blue-100",
  Lowest: "bg-muted text-muted-foreground border-border",
};

export function TaskEditModal({ task, members, deadlines, jiraBaseUrl = "", onSave, onClose }: TaskEditModalProps) {
  const [form, setForm] = useState<TaskSetting>(() => ({ ...task }));
  const [error, setError] = useState<string | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const [prevTaskId, setPrevTaskId] = useState(task.task_id);

  if (task.task_id !== prevTaskId) {
    setPrevTaskId(task.task_id);
    setForm({ ...task });
    setError(null);
  }

  function getDeadlineName(id: string | undefined): string | null {
    if (!id) return null;
    return deadlines.find((d) => d.id === id)?.title ?? null;
  }

  async function handleSave() {
    setError(null);
    try {
      const saved = await upsertTask(form);
      const rankChanged = (form.rank || 0) !== 0 && form.rank !== task.rank;
      if (rankChanged) {
        // Rank shift may have re-ordered other tasks server-side; refetch.
        try {
          const all = await fetchTasks();
          onSave(saved, all);
          return;
        } catch {
          // Fall through to single-task update if refetch fails.
        }
      }
      onSave(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  // Pull the latest summary / priority / Jira status / Dev points (→ effort)
  // for just this issue into the form. The user still presses Save to persist.
  async function handleResync() {
    setResyncing(true);
    setError(null);
    try {
      const result = await syncJira(`key = ${form.task_id}`, 1);
      const issue = result.issues.find((i) => i.key === form.task_id) ?? result.issues[0];
      if (!issue) {
        setError("Issue not found in Jira");
        return;
      }
      setForm((f) => ({
        ...f,
        summary: issue.fields?.summary ?? f.summary,
        priority: issue.fields?.priority?.name ?? f.priority,
        status: issue.fields?.status?.name ?? f.status,
        issue_type: issue.fields?.issuetype?.name ?? f.issue_type,
        effort: devPointsToEffort(issue.fields?.dev_points) ?? f.effort,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resync failed");
    } finally {
      setResyncing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-background rounded-xl border shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-3.5 border-b">
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] font-mono font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
              {form.task_id}
            </span>
            {form.issue_type && (
              <Badge variant="outline" className={`text-[10px] ${issueTypeBadgeStyle(form.issue_type)}`}>
                {form.issue_type}
              </Badge>
            )}
            {form.priority && (
              <Badge variant="outline" className={`text-[10px] ${priorityBadgeClass[form.priority] ?? ""}`}>
                {form.priority}
              </Badge>
            )}
            {form.status && (
              <Badge variant="secondary" className="text-[10px]">{form.status}</Badge>
            )}
          </div>
          <Button variant="ghost" size="icon-xs" onClick={onClose}>
            <X />
          </Button>
        </div>

        <div className="px-5 py-4 space-y-3.5">
          <div className="text-[13px] font-medium text-foreground">{form.summary || form.task_id}</div>

          {error && (
            <div className="bg-destructive/10 text-destructive text-[12px] px-3 py-2 rounded-lg">{error}</div>
          )}

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</Label>
            <Select value={form.plan_status} onValueChange={(val) => setForm({ ...form, plan_status: val as TaskSetting["plan_status"] })}>
              <SelectTrigger className="w-full h-8 text-[12px] mt-1">
                <SelectValue>{form.plan_status}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="OPEN">OPEN</SelectItem>
                <SelectItem value="WIP">WIP</SelectItem>
                <SelectItem value="DONE">DONE</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Assignee</Label>
            <Select value={form.member_email || NONE} onValueChange={(val) => setForm({ ...form, member_email: val === NONE ? "" : String(val) })}>
              <SelectTrigger className="w-full h-8 text-[12px] mt-1">
                <SelectValue>
                  {(value) => {
                    if (!value || value === NONE) return "Unassigned";
                    return members.find((m) => m.email === value)?.name ?? String(value);
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Unassigned</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.email} value={m.email}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Start Date</Label>
            <Input type="date" className="h-8 !text-[12px] mt-1" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Effort (days)</Label>
            <Input type="number" min={0.5} step={0.5} className="h-8 !text-[12px] mt-1" value={form.effort} onChange={(e) => setForm({ ...form, effort: Number(e.target.value) })} />
          </div>

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Rank</Label>
            <Input
              type="number"
              min={1}
              className="h-8 !text-[12px] mt-1"
              value={form.rank || ""}
              placeholder="Auto-assigned"
              onChange={(e) => setForm({ ...form, rank: Number(e.target.value) || 0 })}
            />
            <p className="text-[10px] text-muted-foreground mt-1">Lower rank appears first in Timeline and Tasks.</p>
          </div>

          {deadlines.length > 0 && (
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Deadline</Label>
              <Select value={form.deadline_id ?? NONE} onValueChange={(val) => setForm({ ...form, deadline_id: val === NONE ? undefined : String(val) })}>
                <SelectTrigger className="w-full h-8 text-[12px] mt-1">
                  <SelectValue placeholder="None">
                    {form.deadline_id ? (getDeadlineName(form.deadline_id) ?? form.deadline_id) : "None"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {deadlines.map((dl) => (
                    <SelectItem key={dl.id} value={dl.id}>{dl.title} ({dl.date})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-t">
          <div className="flex items-center gap-2">
            {jiraBaseUrl && (
              <>
                <Button variant="outline" size="sm" onClick={handleResync} disabled={resyncing}>
                  <RefreshCw className={resyncing ? "animate-spin" : ""} />
                  {resyncing ? "Syncing..." : "Resync Jira"}
                </Button>
                <a
                  href={`${jiraBaseUrl}/browse/${form.task_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <ExternalLink />
                  Open in Jira
                </a>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={handleSave}>Save</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
