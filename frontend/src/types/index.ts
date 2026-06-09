export type EventType = "leave" | "oncall" | "holiday" | "other";
export type EventScope = "personal" | "team";
export type TaskStatus = "OPEN" | "WIP" | "DONE";

export interface Member {
  email: string;
  name: string;
  role: string;
  avatar_url: string;
  created_at: string;
  seq: number;
}

export interface CalendarEvent {
  id: string;
  member_emails: string[];
  scope: EventScope;
  type: EventType;
  title: string;
  start_date: string;
  end_date: string;
}

export interface TaskSetting {
  task_id: string;
  summary: string;
  priority: string;
  status?: string;
  member_email: string;
  start_date: string;
  effort: number;
  deadline_id?: string;
  rank: number;
  plan_status: TaskStatus;
}

export interface Deadline {
  id: string;
  title: string;
  date: string;
  color: string;
}

export interface JiraIssue {
  key: string;
  fields?: {
    summary?: string;
    assignee?: {
      emailAddress?: string;
      displayName?: string;
    } | null;
    status?: {
      name?: string;
    } | null;
    priority?: {
      name?: string;
    } | null;
    /** Normalized value of the Jira "Dev points" custom field, mapped to effort. */
    dev_points?: number | null;
  };
}
