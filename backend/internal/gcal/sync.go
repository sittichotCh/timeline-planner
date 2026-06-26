package gcal

import (
	"regexp"

	"timeline-planner/internal/model"
)

var emailRe = regexp.MustCompile(`[\w.+-]+@[\w.-]+\.\w+`)

// extractEmail returns the first email found in s, or "" if none.
func extractEmail(s string) string {
	return emailRe.FindString(s)
}

// titleFor returns the title a synced event should carry. It mirrors the store's
// canonical-title normalization (GetEvents forces "Leave"/"Oncall"/"Holiday" for
// those types), so the title stays stable across syncs; "other" keeps the
// source name.
func titleFor(src model.CalendarSource) string {
	if canonical, ok := model.CanonicalTitle(src.EventType); ok {
		return canonical
	}
	return src.Name
}

// BuildEvents parses an iCal feed and maps each event to a member by the email
// in its SUMMARY. Events with no email, an unknown member, or an RRULE are
// skipped (and counted).
func BuildEvents(src model.CalendarSource, ics string, knownEmails map[string]bool) ([]model.Event, int, error) {
	raws, err := ParseICS(ics)
	if err != nil {
		return nil, 0, err
	}
	title := titleFor(src)

	var out []model.Event
	skipped := 0
	for _, r := range raws {
		if r.HasRRULE {
			skipped++
			continue
		}
		email := extractEmail(r.Summary)
		if email == "" || !knownEmails[email] {
			skipped++
			continue
		}
		out = append(out, model.Event{
			MemberEmails:       []string{email},
			Scope:              model.ScopePersonal,
			Type:               src.EventType,
			Title:              title,
			StartDate:          r.StartDate,
			EndDate:            r.EndDate,
			CountsAsWorkingDay: src.CountsAsWorkingDay,
			Source:             model.SourceGoogle,
			SourceID:           src.ID,
			ExternalUID:        r.UID,
		})
	}
	return out, skipped, nil
}
