package model

type EventType string

const (
	EventLeave   EventType = "leave"
	EventOncall  EventType = "oncall"
	EventHoliday EventType = "holiday"
	EventOther   EventType = "other"
)

type EventScope string

const (
	ScopePersonal EventScope = "personal"
	ScopeTeam     EventScope = "team"
)

// Event source markers. Synced events are owned by their sync source and may be
// overwritten on the next sync; manual events are user-created and never touched.
const (
	SourceManual = "manual"
	SourceGoogle = "google"
)

type Event struct {
	ID                 string     `json:"id"`
	MemberEmails       []string   `json:"member_emails"`
	Scope              EventScope `json:"scope"`
	Type               EventType  `json:"type"`
	Title              string     `json:"title"`
	StartDate          string     `json:"start_date"`
	EndDate            string     `json:"end_date"`
	CountsAsWorkingDay bool       `json:"counts_as_working_day"`
	// Source is "manual" (user-created, default) or "google" (calendar sync).
	Source string `json:"source"`
	// SourceID is the CalendarSource.id that produced a synced event ("" for manual).
	SourceID string `json:"source_id"`
	// ExternalUID is the upstream iCal UID for a synced event ("" for manual).
	ExternalUID string `json:"external_uid"`
}

// NormalizeEventType maps legacy type values to the current set
// (leave, oncall, holiday, other). Unknown values are returned unchanged.
func NormalizeEventType(t EventType) EventType {
	switch t {
	case "vacation":
		return EventLeave
	case "busy":
		return EventOncall
	case "weekend":
		return EventOther
	}
	return t
}

// CanonicalTitle returns the fixed display title for non-"other" types.
// The bool is false for EventOther or an unknown type, in which case the
// caller keeps its own title.
func CanonicalTitle(t EventType) (string, bool) {
	switch t {
	case EventLeave:
		return "Leave", true
	case EventOncall:
		return "Oncall", true
	case EventHoliday:
		return "Holiday", true
	}
	return "", false
}
