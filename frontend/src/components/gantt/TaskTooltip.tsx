import type { TaskSetting, Deadline } from "@/types";

interface TaskTooltipProps {
  task: TaskSetting;
  jiraBaseUrl: string;
  position: { x: number; y: number };
  deadlines?: Deadline[];
}

const priorityStyles: Record<string, string> = {
  Highest: "bg-red-50 text-red-700 ring-1 ring-red-200",
  High: "bg-orange-50 text-orange-700 ring-1 ring-orange-200",
  Medium: "bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200",
  Low: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  Lowest: "bg-gray-50 text-gray-600 ring-1 ring-gray-200",
};

export function TaskTooltip({ task, jiraBaseUrl, position, deadlines = [] }: TaskTooltipProps) {
  const deadline = task.deadline_id ? deadlines.find((d) => d.id === task.deadline_id) : null;

  return (
    <div
      className="bg-white rounded-xl shadow-xl ring-1 ring-black/5 p-4 w-72 backdrop-blur-sm"
      style={{ marginLeft: position.x, marginTop: position.y }}
    >
      <div className="space-y-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md ring-1 ring-indigo-100">
            {task.task_id}
          </span>
          {task.priority && (
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${priorityStyles[task.priority] ?? "bg-gray-50 text-gray-600 ring-1 ring-gray-200"}`}>
              {task.priority}
            </span>
          )}
          {task.status && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-50 text-slate-700 ring-1 ring-slate-200">
              {task.status}
            </span>
          )}
        </div>
        <p className="text-[13px] text-gray-900 font-medium leading-snug">{task.summary}</p>
        <div className="flex gap-4 text-[11px] text-gray-500">
          <div className="flex items-center gap-1">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-gray-400">
              <path fillRule="evenodd" d="M4 1.75a.75.75 0 01.75.75V3h6.5V2.5a.75.75 0 011.5 0V3h.25A1.75 1.75 0 0114.75 4.75v8.5A1.75 1.75 0 0113 15H3A1.75 1.75 0 011.25 13.25v-8.5A1.75 1.75 0 013 3h.25V2.5A.75.75 0 014 1.75z" clipRule="evenodd" />
            </svg>
            {task.start_date}
          </div>
          <div className="flex items-center gap-1">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-gray-400">
              <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm.75-10.25a.75.75 0 00-1.5 0v3.5c0 .199.079.39.22.53l2 2a.75.75 0 101.06-1.06L8.75 7.94V4.75z" clipRule="evenodd" />
            </svg>
            {task.effort} day{task.effort > 1 ? "s" : ""}
          </div>
        </div>
        {deadline && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-600">
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M3.214 1.072a.75.75 0 00-.964.462L.585 6.676a.75.75 0 00.462.964l5.142 1.665a.75.75 0 00.964-.462l1.665-5.142a.75.75 0 00-.462-.964L3.214 1.072zM8 10.5a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm1.5-3.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z" clipRule="evenodd" />
            </svg>
            <span className="font-medium">{deadline.title}</span>
            <span className="text-gray-400">({deadline.date})</span>
          </div>
        )}
        {jiraBaseUrl && (
          <a
            href={`${jiraBaseUrl}/browse/${task.task_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-1 text-[11px] px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium transition-colors shadow-sm"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
              <path d="M4.5 2A2.5 2.5 0 002 4.5v2.879a2.5 2.5 0 00.732 1.767l4.5 4.5a2.5 2.5 0 003.536 0l2.878-2.878a2.5 2.5 0 000-3.536l-4.5-4.5A2.5 2.5 0 007.38 2H4.5zM5 6a1 1 0 100-2 1 1 0 000 2z" />
            </svg>
            Open in Jira
          </a>
        )}
      </div>
    </div>
  );
}
