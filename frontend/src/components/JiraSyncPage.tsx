import { useEffect, useState } from "react";
import type { JiraIssue, Member, TaskSetting } from "@/types";
import { fetchJiraConfig, syncJira } from "@/api/jira";
import { devPointsToEffort } from "@/lib/jira";
import { upsertTask } from "@/api/tasks";
import { createMember } from "@/api/members";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Check, RefreshCw, ExternalLink } from "lucide-react";

interface JiraSyncPageProps {
  members: Member[];
  tasks: TaskSetting[];
  onTasksChange: (tasks: TaskSetting[]) => void;
  onMembersChange: (members: Member[]) => void;
}

const pageSizeOptions = [10, 20, 50, 100];

const priorityBadgeClass: Record<string, string> = {
  Highest: "bg-red-50 text-red-700 border-red-100",
  High: "bg-orange-50 text-orange-700 border-orange-100",
  Medium: "bg-yellow-50 text-yellow-700 border-yellow-100",
  Low: "bg-blue-50 text-blue-700 border-blue-100",
  Lowest: "bg-muted text-muted-foreground border-border",
};

export function JiraSyncPage({ members, tasks, onTasksChange, onMembersChange }: JiraSyncPageProps) {
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [jql, setJql] = useState(() => localStorage.getItem("jira_jql") ?? "");
  const [pageSize, setPageSize] = useState(() => Number(localStorage.getItem("jira_pageSize")) || 20);

  useEffect(() => {
    fetchJiraConfig().then((cfg) => setJiraBaseUrl(cfg.baseUrl)).catch(() => {});
  }, []);

  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [total, setTotal] = useState(0);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function handleSync(e: React.FormEvent) {
    e.preventDefault();
    if (!jql.trim()) return;
    localStorage.setItem("jira_jql", jql);
    localStorage.setItem("jira_pageSize", String(pageSize));
    await fetchPage(undefined);
  }

  async function fetchPage(token: string | undefined) {
    setSyncing(true);
    setError(null);
    try {
      const result = await syncJira(jql, pageSize, token);
      if (token) {
        setIssues((prev) => [...prev, ...result.issues]);
      } else {
        setIssues(result.issues);
        setAdded(new Set());
        setSelected(new Set());
      }
      setTotal(result.total);
      setNextPageToken(result.nextPageToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function ensureMember(email: string, displayName: string): Promise<void> {
    if (!email || members.some((m) => m.email === email)) return;
    try {
      const newMember = await createMember({ email, name: displayName || email, role: "", avatar_url: "" });
      onMembersChange([...members, newMember]);
    } catch {
      // member may already exist
    }
  }

  async function importIssue(issue: JiraIssue): Promise<TaskSetting | null> {
    const assigneeEmail = issue.fields?.assignee?.emailAddress ?? "";
    const displayName = issue.fields?.assignee?.displayName ?? "";
    await ensureMember(assigneeEmail, displayName);
    const task: TaskSetting = {
      task_id: issue.key,
      summary: issue.fields?.summary ?? "",
      priority: issue.fields?.priority?.name ?? "",
      status: issue.fields?.status?.name ?? undefined,
      member_email: assigneeEmail,
      start_date: "",
      effort: devPointsToEffort(issue.fields?.dev_points) ?? 1,
      rank: 0,
      plan_status: "OPEN",
    };
    try {
      return await upsertTask(task);
    } catch {
      return null;
    }
  }

  async function handleAdd(issue: JiraIssue) {
    setError(null);
    const saved = await importIssue(issue);
    if (saved) {
      const taskMap = new Map(tasks.map((t) => [t.task_id, t]));
      taskMap.set(saved.task_id, saved);
      onTasksChange(Array.from(taskMap.values()));
      setAdded((prev) => new Set(prev).add(issue.key));
    } else {
      setError(`Failed to import ${issue.key}`);
    }
  }

  async function handleAddAll() {
    setError(null);
    const toImport = issues.filter((i) => !isAlreadyAdded(i.key));
    const taskMap = new Map(tasks.map((t) => [t.task_id, t]));
    for (const issue of toImport) {
      const saved = await importIssue(issue);
      if (saved) {
        taskMap.set(saved.task_id, saved);
        setAdded((prev) => new Set(prev).add(issue.key));
      }
    }
    onTasksChange(Array.from(taskMap.values()));
  }

  async function handleAddSelected() {
    setError(null);
    const toImport = issues.filter((i) => selected.has(i.key) && !isAlreadyAdded(i.key));
    const taskMap = new Map(tasks.map((t) => [t.task_id, t]));
    for (const issue of toImport) {
      const saved = await importIssue(issue);
      if (saved) {
        taskMap.set(saved.task_id, saved);
        setAdded((prev) => new Set(prev).add(issue.key));
      }
    }
    onTasksChange(Array.from(taskMap.values()));
    setSelected(new Set());
  }

  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function isAlreadyAdded(key: string): boolean {
    return added.has(key) || tasks.some((t) => t.task_id === key);
  }

  function toggleSelectAll() {
    const selectable = issues.filter((i) => !isAlreadyAdded(i.key));
    if (selected.size === selectable.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectable.map((i) => i.key)));
    }
  }

  const selectableCount = issues.filter((i) => !isAlreadyAdded(i.key)).length;

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-card">
        <div className="flex items-center gap-3">
          <h2 className="text-[13px] font-semibold tracking-tight">Jira Sync</h2>
          <Badge variant="secondary" className="text-[11px]">Read-only</Badge>
        </div>
      </div>

      {/* Query form */}
      <form onSubmit={handleSync} className="px-4 py-3 border-b bg-card/50 space-y-2">
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">JQL Query</Label>
          <div className="flex gap-2 mt-1">
            <Input
              placeholder='e.g. project = "MYPROJ" AND sprint in openSprints()'
              value={jql}
              onChange={(e) => setJql(e.target.value)}
              className="flex-1 h-8 !text-[12px]"
            />
            <div className="flex items-center gap-1.5">
              <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Page:</Label>
              <Select value={String(pageSize)} onValueChange={(val) => setPageSize(Number(val))}>
                <SelectTrigger className="w-16 h-8 text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pageSizeOptions.map((n) => (
                    <SelectItem key={n} value={String(n)}>{String(n)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" size="sm" disabled={syncing || !jql.trim()} className="text-[11px]">
              {syncing ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin" />
                  Fetching
                </span>
              ) : "Fetch"}
            </Button>
          </div>
        </div>
      </form>

      {error && (
        <div className="mx-4 mt-2 bg-destructive/10 text-destructive text-[12px] px-3 py-2 rounded-lg">{error}</div>
      )}

      {/* Bulk actions bar */}
      {issues.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30">
          <div className="flex items-center gap-1.5">
            <Checkbox
              checked={selected.size === selectableCount && selectableCount > 0}
              onCheckedChange={toggleSelectAll}
            />
            <Label className="text-[11px] cursor-pointer">Select all</Label>
          </div>
          <Badge variant="secondary" className="text-[11px]">
            {total ? `${issues.length} / ${total}` : issues.length}
          </Badge>
          <div className="ml-auto flex gap-1.5">
            <Button variant="outline" size="xs" onClick={handleAddSelected} disabled={selected.size === 0} className="text-[11px]">
              Add Selected ({selected.size})
            </Button>
            <Button variant="outline" size="xs" onClick={handleAddAll} disabled={selectableCount === 0} className="text-[11px]">
              Add All ({selectableCount})
            </Button>
          </div>
        </div>
      )}

      {/* Issue list */}
      <div className="flex-1 overflow-auto">
        {issues.length === 0 && !syncing ? (
          <div className="text-center py-20">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
              <RefreshCw className="size-6 text-muted-foreground" />
            </div>
            <p className="text-[13px] text-muted-foreground font-medium">Ready to sync</p>
            <p className="text-[11px] text-muted-foreground mt-1">Enter a JQL query and click Fetch to find issues.</p>
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm">
              <tr className="border-b text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                <th className="px-3 py-2 w-[40px]"></th>
                <th className="px-3 py-2 w-[120px]">Key</th>
                <th className="px-3 py-2">Summary</th>
                <th className="px-3 py-2 w-[90px]">Priority</th>
                <th className="px-3 py-2 w-[110px]">Status</th>
                <th className="px-3 py-2 w-[160px]">Assignee</th>
                <th className="px-3 py-2 w-[100px] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => {
                const isAdded = isAlreadyAdded(issue.key);
                const isSelected = selected.has(issue.key);

                return (
                  <tr
                    key={issue.key}
                    className={`border-b transition-colors ${
                      isAdded
                        ? "bg-emerald-50/30"
                        : isSelected
                        ? "bg-accent"
                        : "hover:bg-muted/30"
                    }`}
                  >
                    <td className="px-3 py-1.5">
                      {isAdded ? (
                        <div className="w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center">
                          <Check className="size-2.5 text-emerald-600" />
                        </div>
                      ) : (
                        <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(issue.key)} />
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="text-[10px] font-mono font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                        {issue.key}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-[12px] font-medium text-foreground max-w-0">
                      <div className="truncate">{issue.fields?.summary ?? ""}</div>
                    </td>
                    <td className="px-3 py-1.5">
                      {issue.fields?.priority?.name && (
                        <Badge variant="outline" className={`text-[10px] ${priorityBadgeClass[issue.fields.priority.name] ?? ""}`}>
                          {issue.fields.priority.name}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {issue.fields?.status?.name && (
                        <Badge variant="secondary" className="text-[10px]">
                          {issue.fields.status.name}
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-[12px] text-muted-foreground">
                      {issue.fields?.assignee?.displayName ?? "Unassigned"}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        {jiraBaseUrl && (
                          <a
                            href={`${jiraBaseUrl}/browse/${issue.key}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open in Jira"
                            className="inline-flex items-center justify-center size-6 rounded-[min(var(--radius-md),10px)] text-muted-foreground hover:bg-muted hover:text-indigo-600 transition-colors"
                          >
                            <ExternalLink className="size-3" />
                          </a>
                        )}
                        {isAdded ? (
                          <span className="text-[10px] text-emerald-600 font-semibold px-1.5">Added</span>
                        ) : (
                          <Button variant="outline" size="xs" onClick={() => handleAdd(issue)} className="text-[11px] text-emerald-700 border-emerald-200 hover:bg-emerald-50">
                            Add
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {nextPageToken && (
          <div className="px-4 py-3">
            <Button variant="outline" className="w-full text-[12px]" onClick={() => fetchPage(nextPageToken)} disabled={syncing}>
              {syncing ? "Loading..." : `Load more${total ? ` (${issues.length} / ${total})` : ""}`}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
