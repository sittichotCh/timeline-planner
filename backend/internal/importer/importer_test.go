package importer

import (
	"strings"
	"testing"

	"timeline-planner/internal/model"
)

func TestParseValidEventAndDeadline(t *testing.T) {
	csv := `event_type,title,start_date,end_date,member_emails,scope,type,color
event,Regression,2026-05-25,2026-05-29,a@co.com|b@co.com,personal,other,
deadline,Release 1%,2026-08-03,,,,,blue
`
	events, deadlines, rowErrs, err := Parse(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rowErrs) != 0 {
		t.Fatalf("unexpected row errors: %v", rowErrs)
	}
	if len(events) != 1 || len(deadlines) != 1 {
		t.Fatalf("got %d events, %d deadlines; want 1,1", len(events), len(deadlines))
	}
	e := events[0]
	if e.Title != "Regression" || e.Type != model.EventOther || e.Scope != model.ScopePersonal {
		t.Errorf("unexpected event: %+v", e)
	}
	if len(e.MemberEmails) != 2 {
		t.Errorf("expected 2 emails, got %v", e.MemberEmails)
	}
	if e.ID != "" {
		t.Errorf("importer must not assign IDs, got %q", e.ID)
	}
	d := deadlines[0]
	if d.Title != "Release 1%" || d.Date != "2026-08-03" || d.Color != "blue" {
		t.Errorf("unexpected deadline: %+v", d)
	}
}

func TestParseHeaderOrderIndependentAndExtraColumns(t *testing.T) {
	csv := `note,type,event_type,title,end_date,start_date,scope
ignored,holiday,event,whatever,2026-06-01,2026-06-01,team
`
	events, _, rowErrs, err := Parse(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rowErrs) != 0 {
		t.Fatalf("unexpected row errors: %v", rowErrs)
	}
	if len(events) != 1 {
		t.Fatalf("want 1 event, got %d", len(events))
	}
	e := events[0]
	if e.Type != model.EventHoliday {
		t.Errorf("want holiday, got %q", e.Type)
	}
	if e.Title != "Holiday" { // canonicalized
		t.Errorf("want canonical title Holiday, got %q", e.Title)
	}
	if e.Scope != model.ScopeTeam {
		t.Errorf("want team scope, got %q", e.Scope)
	}
}

func TestParseEventDefaults(t *testing.T) {
	// blank scope -> personal; blank type -> other (needs title + members)
	csv := `event_type,title,start_date,end_date,member_emails,scope,type
event,My Task,2026-06-01,2026-06-02,a@co.com,,
`
	events, _, rowErrs, err := Parse(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(rowErrs) != 0 {
		t.Fatalf("row errs: %v", rowErrs)
	}
	if len(events) != 1 {
		t.Fatalf("want 1, got %d", len(events))
	}
	if events[0].Scope != model.ScopePersonal {
		t.Errorf("want personal scope")
	}
	if events[0].Type != model.EventOther {
		t.Errorf("want other type")
	}
}

func TestParseSkipsBlankCommaOnlyRows(t *testing.T) {
	csv := "event_type,title,start_date,end_date,member_emails,scope,type\n" +
		",,,,,,\n" +
		"event,X,2026-06-01,2026-06-02,a@co.com,personal,other\n"
	events, _, rowErrs, err := Parse(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(rowErrs) != 0 {
		t.Fatalf("blank row must not be an error: %v", rowErrs)
	}
	if len(events) != 1 {
		t.Fatalf("want 1 event, got %d", len(events))
	}
}

func TestParseRowErrors(t *testing.T) {
	cases := []struct {
		name string
		row  string
		want string
	}{
		{"unknown event_type", "task,X,2026-06-01,2026-06-02,a@co.com,personal,other", "unknown event_type"},
		{"bad start date", "event,X,2026-13-40,2026-06-02,a@co.com,personal,other", "invalid start_date"},
		{"bad end date", "event,X,2026-06-01,nope,a@co.com,personal,other", "invalid end_date"},
		{"end before start", "event,X,2026-06-05,2026-06-01,a@co.com,personal,other", "end_date is before start_date"},
		{"other needs title", "event,,2026-06-01,2026-06-02,a@co.com,personal,other", "title is required"},
		{"personal needs members", "event,X,2026-06-01,2026-06-02,,personal,other", "member_emails is required"},
		{"bad scope", "event,X,2026-06-01,2026-06-02,a@co.com,nope,other", "invalid scope"},
		{"bad type", "event,X,2026-06-01,2026-06-02,a@co.com,personal,bogus", "unknown type"},
		{"deadline needs title", "deadline,,2026-08-03,,,,", "title is required"},
		{"deadline bad date", "deadline,Ship,nope,,,,", "invalid start_date"},
	}
	header := "event_type,title,start_date,end_date,member_emails,scope,type\n"
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			events, deadlines, rowErrs, err := Parse(strings.NewReader(header + tc.row + "\n"))
			if err != nil {
				t.Fatalf("unexpected fatal err: %v", err)
			}
			if len(events) != 0 || len(deadlines) != 0 {
				t.Fatalf("expected no valid items, got %d events %d deadlines", len(events), len(deadlines))
			}
			if len(rowErrs) != 1 {
				t.Fatalf("expected 1 row error, got %d: %v", len(rowErrs), rowErrs)
			}
			if rowErrs[0].Row != 2 {
				t.Errorf("expected error on line 2, got %d", rowErrs[0].Row)
			}
			if !strings.Contains(rowErrs[0].Reason, tc.want) {
				t.Errorf("reason %q does not contain %q", rowErrs[0].Reason, tc.want)
			}
		})
	}
}

func TestParseFatalErrors(t *testing.T) {
	if _, _, _, err := Parse(strings.NewReader("")); err == nil {
		t.Error("expected error for empty file")
	}
	if _, _, _, err := Parse(strings.NewReader("title,date\nX,2026-01-01\n")); err == nil {
		t.Error("expected error for missing event_type header")
	}
}
