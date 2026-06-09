import { useEffect, useMemo, useState } from "react";
import type { Member, TaskSetting, TaskStatus, JiraIssue, Deadline } from "@/types";
import { deleteTask, fetchTasks, reorderTasks, upsertTask } from "@/api/tasks";
import { fetchJiraConfig, syncJira } from "@/api/jira";
import { devPointsToEffort } from "@/lib/jira";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TaskEditModal } from "@/components/TaskEditModal";
import { Search, RefreshCw, ClipboardCheck, Pencil, Trash2, ExternalLink, GripVertical, X } from "lucide-react";

const ALL = "__all__";
const UNASSIGNED = "__unassigned__";

const FILTER_STORAGE_KEY = "task-filters";

interface SavedFilters {
  state?: string;
  jiraStatus?: string;
  assignee?: string;
}

function loadFilters(): SavedFilters {
  try {
    return JSON.parse(localStorage.getItem(FILTER_STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveFilters(patch: SavedFilters) {
  localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ ...loadFilters(), ...patch }));
}

const planStatusClass: Record<TaskStatus, string> = {
  OPEN: "text-slate-600",
  WIP: "text-amber-600",
  DONE: "text-green-600",
};

interface TaskPageProps {
  tasks: TaskSetting[];
  members: Member[];
  deadlines: Deadline[];
  onTasksChange: (tasks: TaskSetting[]) => void;
  initialEditId?: string | null;
  onClearEditId?: () => void;
}

const priorityBadgeClass: Record<string, string> = {
  Highest: "bg-red-50 text-red-700 border-red-100",
  High: "bg-orange-50 text-orange-700 border-orange-100",
  Medium: "bg-yellow-50 text-yellow-700 border-yellow-100",
  Low: "bg-blue-50 text-blue-700 border-blue-100",
  Lowest: "bg-muted text-muted-foreground border-border",
};

export function TaskPage({ tasks, members, deadlines, onTasksChange, initialEditId, onClearEditId }: TaskPageProps) {
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<string>(() => loadFilters().state ?? ALL);
  const [jiraStatusFilter, setJiraStatusFilter] = useState<string>(() => loadFilters().jiraStatus ?? ALL);
  const [assigneeFilter, setAssigneeFilter] = useState<string>(() => loadFilters().assignee ?? ALL);
  const [editingTask, setEditingTask] = useState<TaskSetting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);

  useEffect(() => {
    fetchJiraConfig().then((cfg) => setJiraBaseUrl(cfg.baseUrl)).catch(() => {});
  }, []);

  const [prevEditId, setPrevEditId] = useState<string | null>(null);
  if (initialEditId && initialEditId !== prevEditId) {
    setPrevEditId(initialEditId);
    const task = tasks.find((t) => t.task_id === initialEditId);
    if (task) setEditingTask(task);
    onClearEditId?.();
  }

  // Distinct Jira statuses and assignees present in the current task set.
  const jiraStatuses = useMemo(
    () => [...new Set(tasks.map((t) => t.status).filter((s): s is string => !!s))].sort(),
    [tasks],
  );
  const assigneeEmails = useMemo(
    () => [...new Set(tasks.map((t) => t.member_email))].sort((a, b) =>
      getMemberName(a).localeCompare(getMemberName(b)),
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, members],
  );

  const filtersActive =
    search.trim() !== "" || stateFilter !== ALL || jiraStatusFilter !== ALL || assigneeFilter !== ALL;
  // Reordering ranks a subset incorrectly, so only allow drag with no filters.
  const dragEnabled = !filtersActive;

  const filteredTasks = tasks.filter((t) => {
    const q = search.trim().toLowerCase();
    if (
      q &&
      !(
        t.task_id.toLowerCase().includes(q) ||
        t.summary.toLowerCase().includes(q) ||
        getMemberName(t.member_email).toLowerCase().includes(q)
      )
    )
      return false;
    if (stateFilter !== ALL && t.plan_status !== stateFilter) return false;
    if (jiraStatusFilter !== ALL && (t.status ?? "") !== jiraStatusFilter) return false;
    if (assigneeFilter === UNASSIGNED && t.member_email) return false;
    if (assigneeFilter !== ALL && assigneeFilter !== UNASSIGNED && t.member_email !== assigneeFilter)
      return false;
    return true;
  });

  function clearFilters() {
    setSearch("");
    setStateFilter(ALL);
    setJiraStatusFilter(ALL);
    setAssigneeFilter(ALL);
    saveFilters({ state: ALL, jiraStatus: ALL, assignee: ALL });
  }

  async function handleDelete(taskId: string) {
    try {
      await deleteTask(taskId);
      onTasksChange(tasks.filter((t) => t.task_id !== taskId));
      if (editingTask?.task_id === taskId) setEditingTask(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function getMemberName(email: string): string {
    if (!email) return "Unassigned";
    return members.find((m) => m.email === email)?.name ?? email;
  }

  function getDeadlineName(id: string | undefined): string | null {
    if (!id) return null;
    return deadlines.find((d) => d.id === id)?.title ?? null;
  }

  function handleDragStart(e: React.DragEvent, taskId: string) {
    if (!dragEnabled) return;
    setDraggedTaskId(taskId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", taskId);
  }

  function handleDragOver(e: React.DragEvent, taskId: string) {
    if (!dragEnabled || !draggedTaskId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (taskId !== dragOverTaskId) setDragOverTaskId(taskId);
  }

  function handleDragLeave(taskId: string) {
    if (dragOverTaskId === taskId) setDragOverTaskId(null);
  }

  async function handleDrop(e: React.DragEvent, targetTaskId: string) {
    e.preventDefault();
    const dragged = draggedTaskId;
    setDraggedTaskId(null);
    setDragOverTaskId(null);
    if (!dragged || dragged === targetTaskId) return;

    const fromIdx = tasks.findIndex((t) => t.task_id === dragged);
    const toIdx = tasks.findIndex((t) => t.task_id === targetTaskId);
    if (fromIdx === -1 || toIdx === -1) return;

    const next = [...tasks];
    const [moved] = next.splice(fromIdx, 1);
    if (!moved) return;
    next.splice(toIdx, 0, moved);
    const reranked = next.map((t, i) => ({ ...t, rank: i + 1 }));

    const previous = tasks;
    onTasksChange(reranked);
    try {
      await reorderTasks(reranked.map((t) => ({ task_id: t.task_id, rank: t.rank })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reorder failed");
      onTasksChange(previous);
      fetchTasks().then(onTasksChange).catch(() => {});
    }
  }

  function handleDragEnd() {
    setDraggedTaskId(null);
    setDragOverTaskId(null);
  }

  async function handleResync() {
    if (tasks.length === 0 || !jiraBaseUrl) return;
    setResyncing(true);
    setError(null);
    try {
      const taskIds = tasks.map((t) => t.task_id);
      const jql = `key in (${taskIds.join(", ")})`;
      let allIssues: JiraIssue[] = [];
      let token: string | undefined;
      do {
        const result = await syncJira(jql, 100, token);
        allIssues = [...allIssues, ...result.issues];
        token = result.nextPageToken;
      } while (token);
      const issueMap = new Map(allIssues.map((i) => [i.key, i]));
      const updatedTasks: TaskSetting[] = [];
      for (const task of tasks) {
        const issue = issueMap.get(task.task_id);
        if (issue) {
          const updated: TaskSetting = {
            ...task,
            summary: issue.fields?.summary ?? task.summary,
            priority: issue.fields?.priority?.name ?? task.priority,
            status: issue.fields?.status?.name ?? task.status,
            // Re-apply Dev points → effort; keep the existing effort if unset.
            effort: devPointsToEffort(issue.fields?.dev_points) ?? task.effort,
          };
          const saved = await upsertTask(updated);
          updatedTasks.push(saved);
        } else {
          updatedTasks.push(task);
        }
      }
      onTasksChange(updatedTasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resync failed");
    } finally {
      setResyncing(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b bg-card flex-wrap">
        <div className="flex items-center gap-3">
          <h2 className="text-[13px] font-semibold tracking-tight">Tasks</h2>
          <Badge variant="secondary" className="text-[11px]">
            {filtersActive ? `${filteredTasks.length} / ${tasks.length}` : `${tasks.length} tasks`}
          </Badge>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="size-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input
              placeholder="Search tasks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 w-48 h-7 text-[12px]"
            />
          </div>

          <Select value={stateFilter} onValueChange={(v) => { const nv = v ?? ALL; setStateFilter(nv); saveFilters({ state: nv }); }}>
            <SelectTrigger size="sm" className="h-7 text-[12px] min-w-[108px]">
              <SelectValue>{stateFilter === ALL ? "All States" : stateFilter}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All States</SelectItem>
              <SelectItem value="OPEN">OPEN</SelectItem>
              <SelectItem value="WIP">WIP</SelectItem>
              <SelectItem value="DONE">DONE</SelectItem>
            </SelectContent>
          </Select>

          <Select value={jiraStatusFilter} onValueChange={(v) => { const nv = v ?? ALL; setJiraStatusFilter(nv); saveFilters({ jiraStatus: nv }); }}>
            <SelectTrigger size="sm" className="h-7 text-[12px] min-w-[120px]">
              <SelectValue>{jiraStatusFilter === ALL ? "All Jira Status" : jiraStatusFilter}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Jira Status</SelectItem>
              {jiraStatuses.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={assigneeFilter} onValueChange={(v) => { const nv = v ?? ALL; setAssigneeFilter(nv); saveFilters({ assignee: nv }); }}>
            <SelectTrigger size="sm" className="h-7 text-[12px] min-w-[130px]">
              <SelectValue>
                {assigneeFilter === ALL
                  ? "All Assignees"
                  : assigneeFilter === UNASSIGNED
                    ? "Unassigned"
                    : getMemberName(assigneeFilter)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All Assignees</SelectItem>
              {assigneeEmails.map((email) => (
                <SelectItem key={email || UNASSIGNED} value={email || UNASSIGNED}>
                  {email ? getMemberName(email) : "Unassigned"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={clearFilters} title="Clear filters">
              <X />
              Clear
            </Button>
          )}

          {jiraBaseUrl && tasks.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleResync} disabled={resyncing}>
              <RefreshCw className={resyncing ? "animate-spin" : ""} />
              {resyncing ? "Syncing..." : "Resync Jira"}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-2 bg-destructive/10 text-destructive text-[12px] px-3 py-2 rounded-lg">{error}</div>
      )}

      <div className="flex-1 overflow-auto">
        {filteredTasks.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
              <ClipboardCheck className="size-6 text-muted-foreground" />
            </div>
            <p className="text-[13px] text-muted-foreground font-medium">
              {filtersActive ? "No tasks match the filters" : "No tasks yet"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {filtersActive ? "Try adjusting or clearing the filters." : "Import tasks from Jira Sync."}
            </p>
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm">
              <tr className="border-b text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                <th className="px-1 py-2 w-[28px]"></th>
                <th className="px-2 py-2 w-[60px] text-center">Rank</th>
                <th className="px-3 py-2 w-[140px]">Task ID</th>
                <th className="px-3 py-2">Summary</th>
                <th className="px-3 py-2 w-[90px]">Priority</th>
                <th className="px-3 py-2 w-[110px]">Jira Status</th>
                <th className="px-3 py-2 w-[100px]">State</th>
                <th className="px-3 py-2 w-[160px]">Assignee</th>
                <th className="px-3 py-2 w-[130px]">Start Date</th>
                <th className="px-3 py-2 w-[120px]">Effort</th>
                <th className="px-3 py-2 w-[140px]">Deadline</th>
                <th className="px-3 py-2 w-[100px] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((task) => {
                const isDragging = draggedTaskId === task.task_id;
                const isDragOver = dragOverTaskId === task.task_id && draggedTaskId !== task.task_id;
                return (
                  <tr
                    key={task.task_id}
                    draggable={dragEnabled}
                    onDragStart={(e) => handleDragStart(e, task.task_id)}
                    onDragOver={(e) => handleDragOver(e, task.task_id)}
                    onDragLeave={() => handleDragLeave(task.task_id)}
                    onDrop={(e) => handleDrop(e, task.task_id)}
                    onDragEnd={handleDragEnd}
                    className={`border-b hover:bg-muted/30 transition-colors group ${isDragging ? "opacity-40" : ""} ${isDragOver ? "bg-indigo-50/60 border-indigo-200" : ""}`}
                  >
                    <td className="px-1 py-1.5">
                      <div
                        className={`flex items-center justify-center ${dragEnabled ? "cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground" : "cursor-not-allowed text-muted-foreground/30"}`}
                        title={dragEnabled ? "Drag to reorder" : "Clear filters to reorder"}
                      >
                        <GripVertical className="size-3.5" />
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <span className="text-[15px] font-mono font-semibold text-foreground tabular-nums">
                        {task.rank || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="text-[10px] font-mono font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                        {task.task_id}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-[12px] font-medium text-foreground max-w-0">
                      <div className="truncate">{task.summary || task.task_id}</div>
                    </td>
                    <td className="px-3 py-1.5">
                      {task.priority && (
                        <Badge variant="outline" className={`text-[10px] ${priorityBadgeClass[task.priority] ?? ""}`}>
                          {task.priority}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {task.status ? (
                        <Badge variant="secondary" className="text-[10px]">{task.status}</Badge>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge variant="outline" className={`text-[10px] font-semibold ${planStatusClass[task.plan_status] ?? ""}`}>
                        {task.plan_status}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 text-[12px] text-muted-foreground">
                      {getMemberName(task.member_email)}
                    </td>
                    <td className="px-3 py-1.5 text-[11px] text-muted-foreground tabular-nums">
                      {task.start_date || <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className="px-3 py-1.5 text-[11px] text-muted-foreground tabular-nums">
                      {task.effort} day{task.effort > 1 ? "s" : ""}
                    </td>
                    <td className="px-3 py-1.5 text-[12px] text-muted-foreground">
                      {getDeadlineName(task.deadline_id) ? (
                        <span className="text-amber-600">{getDeadlineName(task.deadline_id)}</span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {jiraBaseUrl && (
                          <a
                            href={`${jiraBaseUrl}/browse/${task.task_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open in Jira"
                            className="inline-flex items-center justify-center size-6 rounded-[min(var(--radius-md),10px)] text-muted-foreground hover:bg-muted hover:text-indigo-600 transition-colors"
                          >
                            <ExternalLink className="size-3" />
                          </a>
                        )}
                        <Button variant="ghost" size="icon-xs" onClick={() => setEditingTask(task)} title="Edit">
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(task.task_id)} title="Delete">
                          <Trash2 className="text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editingTask && (
        <TaskEditModal
          task={editingTask}
          members={members}
          deadlines={deadlines}
          jiraBaseUrl={jiraBaseUrl}
          onSave={(saved, allTasks) => {
            if (allTasks) {
              onTasksChange(allTasks);
            } else {
              onTasksChange(tasks.map((t) => (t.task_id === saved.task_id ? saved : t)));
            }
            setEditingTask(null);
          }}
          onClose={() => setEditingTask(null)}
        />
      )}
    </div>
  );
}
