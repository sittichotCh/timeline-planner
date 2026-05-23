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
