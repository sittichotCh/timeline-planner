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
  counts_as_working_day: boolean;
  /** "manual" (user-created) or "google" (calendar sync). Optional on writes. */
  source?: string;
  source_id?: string;
  external_uid?: string;
}

export interface TaskSetting {
  task_id: string;
  summary: string;
  priority: string;
  status?: string;
  /** Jira issue/card type, e.g. Story, Bug, Task, Epic. */
  issue_type?: string;
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
    issuetype?: {
      name?: string;
      iconUrl?: string;
    } | null;
    /** Normalized value of the Jira "Dev points" custom field, mapped to effort. */
    dev_points?: number | null;
  };
}

export interface ImportRowError {
  row: number;
  reason: string;
}

export interface ImportResult {
  imported_events: number;
  imported_deadlines: number;
  skipped_duplicates: number;
  errors: ImportRowError[];
}

export interface CalendarSource {
  id: string;
  name: string;
  url: string;
  event_type: EventType;
  last_synced_at?: string;
}

export interface CalendarSyncSourceResult {
  source_id: string;
  name: string;
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  error?: string;
}

export interface CalendarSyncResult {
  sources: CalendarSyncSourceResult[];
  added: number;
  updated: number;
  removed: number;
  skipped: number;
}
