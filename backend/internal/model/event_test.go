package model

import "testing"

func TestNormalizeEventType(t *testing.T) {
	cases := map[EventType]EventType{
		"vacation":   EventLeave,
		"busy":       EventOncall,
		"weekend":    EventOther,
		EventLeave:   EventLeave,
		EventOncall:  EventOncall,
		EventHoliday: EventHoliday,
		EventOther:   EventOther,
		"unknown":    "unknown",
	}
	for in, want := range cases {
		if got := NormalizeEventType(in); got != want {
			t.Errorf("NormalizeEventType(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCanonicalTitle(t *testing.T) {
	if title, ok := CanonicalTitle(EventLeave); !ok || title != "Leave" {
		t.Errorf("CanonicalTitle(leave) = %q, %v; want \"Leave\", true", title, ok)
	}
	if title, ok := CanonicalTitle(EventHoliday); !ok || title != "Holiday" {
		t.Errorf("CanonicalTitle(holiday) = %q, %v; want \"Holiday\", true", title, ok)
	}
	if title, ok := CanonicalTitle(EventOncall); !ok || title != "Oncall" {
		t.Errorf("CanonicalTitle(oncall) = %q, %v; want \"Oncall\", true", title, ok)
	}
	if title, ok := CanonicalTitle(EventOther); ok || title != "" {
		t.Errorf("CanonicalTitle(other) = %q, %v; want \"\", false", title, ok)
	}
}
