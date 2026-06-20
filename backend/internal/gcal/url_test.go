package gcal

import "testing"

const exampleShareURL = "https://calendar.google.com/calendar/u/0?cid=Y19iY2FhZWU1OGY1OTQ5NjZiNjUxNDhkZjg5OWU3MGYyOTE5MDhiOTc5YzY5NDFiNmI4ZmFmNDI1ZmYxYTE2Njg3QGdyb3VwLmNhbGVuZGFyLmdvb2dsZS5jb20"

const exampleFeedURL = "https://calendar.google.com/calendar/ical/c_bcaaee58f594966b65148df899e70f291908b979c6941b6b8faf425ff1a16687%40group.calendar.google.com/public/basic.ics"

func TestResolveFeedURLFromCID(t *testing.T) {
	got, err := ResolveFeedURL(exampleShareURL)
	if err != nil {
		t.Fatalf("ResolveFeedURL: %v", err)
	}
	if got != exampleFeedURL {
		t.Errorf("got  %s\nwant %s", got, exampleFeedURL)
	}
}

func TestResolveFeedURLPassthroughICS(t *testing.T) {
	raw := "https://example.com/whatever/basic.ics"
	got, err := ResolveFeedURL(raw)
	if err != nil {
		t.Fatalf("ResolveFeedURL: %v", err)
	}
	if got != raw {
		t.Errorf("want passthrough, got %s", got)
	}
}

func TestResolveFeedURLBareID(t *testing.T) {
	got, err := ResolveFeedURL("c_abc123@group.calendar.google.com")
	if err != nil {
		t.Fatalf("ResolveFeedURL: %v", err)
	}
	want := "https://calendar.google.com/calendar/ical/c_abc123%40group.calendar.google.com/public/basic.ics"
	if got != want {
		t.Errorf("got %s want %s", got, want)
	}
}

func TestResolveFeedURLEmpty(t *testing.T) {
	if _, err := ResolveFeedURL("   "); err == nil {
		t.Errorf("want error for empty URL")
	}
}
