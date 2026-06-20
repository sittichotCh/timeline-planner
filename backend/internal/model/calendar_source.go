package model

// CalendarSource is a registered public Google Calendar feed. Sync fetches its
// iCal feed and writes matching events tagged with Source=google + SourceID=ID.
type CalendarSource struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	URL          string    `json:"url"`
	EventType    EventType `json:"event_type"`
	LastSyncedAt string    `json:"last_synced_at"`
}
