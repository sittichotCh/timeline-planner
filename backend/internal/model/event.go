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

type Event struct {
	ID           string     `json:"id"`
	MemberEmails []string   `json:"member_emails"`
	Scope        EventScope `json:"scope"`
	Type         EventType  `json:"type"`
	Title        string     `json:"title"`
	StartDate    string     `json:"start_date"`
	EndDate      string     `json:"end_date"`
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
