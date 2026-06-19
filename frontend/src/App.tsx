import { useCallback, useEffect, useState } from "react";
import type { Member, TaskSetting, CalendarEvent, Deadline } from "@/types";
import { fetchMembers } from "@/api/members";
import { fetchEvents, updateEvent } from "@/api/events";
import { fetchTasks, upsertTask } from "@/api/tasks";
import { fetchDeadlines, updateDeadline } from "@/api/deadlines";
import { fetchJiraConfig } from "@/api/jira";
import { GanttChart } from "@/components/gantt/GanttChart";
import { MemberPanel } from "@/components/MemberPanel";
import { EventPanel } from "@/components/EventPanel";
import { JiraSyncPage } from "@/components/JiraSyncPage";
import { TaskPage } from "@/components/TaskPage";
import { TaskEditModal } from "@/components/TaskEditModal";
import { DeadlinePanel } from "@/components/DeadlinePanel";
import { ImportPanel } from "@/components/ImportPanel";
import { Button } from "@/components/ui/button";
import { Users, CalendarDays, ClipboardCheck, RefreshCw, Flag, GanttChartSquare, Upload } from "lucide-react";

type PageView = "timeline" | "tasks" | "jira";
type SlidePanel = "members" | "events" | "deadlines" | "import" | null;

const pageItems: { key: PageView; label: string; icon: typeof Users }[] = [
  { key: "timeline", label: "Timeline", icon: GanttChartSquare },
  { key: "tasks", label: "Tasks", icon: ClipboardCheck },
  { key: "jira", label: "Jira Sync", icon: RefreshCw },
];

const panelItems: { key: "members" | "events" | "deadlines" | "import"; label: string; icon: typeof Users }[] = [
  { key: "members", label: "Members", icon: Users },
  { key: "events", label: "Events", icon: CalendarDays },
  { key: "deadlines", label: "Deadlines", icon: Flag },
  { key: "import", label: "Import", icon: Upload },
];

function App() {
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<TaskSetting[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<PageView>("timeline");
  const [panel, setPanel] = useState<SlidePanel>(null);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchMembers(),
      fetchTasks(),
      fetchEvents(),
      fetchDeadlines().catch(() => [] as Deadline[]),
    ])
      .then(([m, t, e, d]) => {
        setMembers(m);
        setTasks(t);
        setEvents(e);
        setDeadlines(d);
      })
      .finally(() => setLoading(false));
    fetchJiraConfig().then((cfg) => setJiraBaseUrl(cfg.baseUrl)).catch(() => {});
  }, []);

  const handleTaskUpdate = useCallback(async (updated: TaskSetting) => {
    try {
      const saved = await upsertTask(updated);
      setTasks((prev) => prev.map((t) => (t.task_id === saved.task_id ? saved : t)));
    } catch {
      fetchTasks().then(setTasks).catch(() => {});
    }
  }, []);

  const handleEventUpdate = useCallback(async (updated: CalendarEvent) => {
    setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    try {
      const saved = await updateEvent(updated.id, updated);
      setEvents((prev) => prev.map((e) => (e.id === saved.id ? saved : e)));
    } catch {
      fetchEvents().then(setEvents).catch(() => {});
    }
  }, []);

  const handleDeadlineUpdate = useCallback(async (updated: Deadline) => {
    setDeadlines((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    try {
      const saved = await updateDeadline(updated.id, updated);
      setDeadlines((prev) => prev.map((d) => (d.id === saved.id ? saved : d)));
    } catch {
      fetchDeadlines().then(setDeadlines).catch(() => {});
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 animate-pulse" />
          <p className="text-[13px] text-muted-foreground font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="flex items-center justify-between px-5 py-2.5 bg-card/80 backdrop-blur-xl border-b shadow-[0_1px_3px_rgba(0,0,0,0.04)] sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-white">
              <rect x="2" y="3" width="10" height="3" rx="1" />
              <rect x="6" y="9" width="12" height="3" rx="1" />
              <rect x="4" y="15" width="8" height="3" rx="1" />
            </svg>
          </div>
          <h1 className="text-[15px] font-semibold tracking-tight">Timeline Planner</h1>
        </div>
        <nav className="flex gap-1">
          {pageItems.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.key}
                variant={page === item.key ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setPage(item.key)}
              >
                <Icon />
                {item.label}
              </Button>
            );
          })}
          <div className="w-px h-5 bg-border self-center mx-1" />
          {panelItems.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.key}
                variant={panel === item.key ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setPanel(panel === item.key ? null : item.key)}
              >
                <Icon />
                {item.label}
              </Button>
            );
          })}
        </nav>
      </header>
      <main className="flex-1 overflow-hidden">
        {page === "tasks" ? (
          <TaskPage
            tasks={tasks}
            members={members}
            deadlines={deadlines}
            onTasksChange={setTasks}
            initialEditId={editTaskId}
            onClearEditId={() => setEditTaskId(null)}
          />
        ) : page === "jira" ? (
          <JiraSyncPage
            members={members}
            tasks={tasks}
            onTasksChange={setTasks}
            onMembersChange={setMembers}
          />
        ) : (
          <GanttChart
            members={members}
            tasks={tasks}
            events={events}
            deadlines={deadlines}
            jiraBaseUrl={jiraBaseUrl}
            onTaskUpdate={handleTaskUpdate}
            onOpenTask={(taskId) => setEditTaskId(taskId)}
            onEventUpdate={handleEventUpdate}
            onDeadlineUpdate={handleDeadlineUpdate}
          />
        )}
      </main>

      {editTaskId && page !== "tasks" && (() => {
        const task = tasks.find((t) => t.task_id === editTaskId);
        if (!task) return null;
        return (
          <TaskEditModal
            task={task}
            members={members}
            deadlines={deadlines}
            jiraBaseUrl={jiraBaseUrl}
            onSave={(saved, allTasks) => {
              if (allTasks) {
                setTasks(allTasks);
              } else {
                setTasks((prev) => prev.map((t) => (t.task_id === saved.task_id ? saved : t)));
              }
              setEditTaskId(null);
            }}
            onDelete={(taskId) => {
              setTasks((prev) => prev.filter((t) => t.task_id !== taskId));
              setEditTaskId(null);
            }}
            onClose={() => setEditTaskId(null)}
          />
        );
      })()}

      {panel === "members" && (
        <MemberPanel
          members={members}
          onMembersChange={setMembers}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "events" && (
        <EventPanel
          events={events}
          members={members}
          onEventsChange={setEvents}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "deadlines" && (
        <DeadlinePanel
          deadlines={deadlines}
          onDeadlinesChange={setDeadlines}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "import" && (
        <ImportPanel
          members={members}
          onImported={() => {
            Promise.all([fetchEvents(), fetchDeadlines()])
              .then(([e, d]) => {
                setEvents(e);
                setDeadlines(d);
              })
              .catch(() => {});
          }}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}

export default App;
