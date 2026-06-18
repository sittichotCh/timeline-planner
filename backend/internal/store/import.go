package store

import (
	"sort"
	"strings"

	"timeline-planner/internal/model"
)

const keySep = "\x1f" // unit separator: safe delimiter for composite keys

// eventKey is the content identity of an event for duplicate detection.
// Member emails are sorted so ordering does not affect identity.
func eventKey(e model.Event) string {
	emails := append([]string(nil), e.MemberEmails...)
	sort.Strings(emails)
	return strings.Join([]string{
		string(e.Scope),
		string(e.Type),
		e.Title,
		e.StartDate,
		e.EndDate,
		strings.Join(emails, "|"),
	}, keySep)
}

// deadlineKey is the content identity of a deadline (color is cosmetic and
// excluded).
func deadlineKey(d model.Deadline) string {
	return d.Title + keySep + d.Date
}

// ImportEvents appends candidates that are not duplicates of an existing event
// or of an earlier accepted candidate in the same batch. Accepted events get a
// fresh ID. Returns how many were added and how many were skipped.
func (s *Store) ImportEvents(candidates []model.Event) (added int, skipped int, err error) {
	existing, err := s.GetEvents()
	if err != nil {
		return 0, 0, err
	}
	seen := make(map[string]bool, len(existing)+len(candidates))
	for _, e := range existing {
		seen[eventKey(e)] = true
	}
	result := existing
	for _, c := range candidates {
		k := eventKey(c)
		if seen[k] {
			skipped++
			continue
		}
		seen[k] = true
		c.ID = genID()
		result = append(result, c)
		added++
	}
	if added > 0 {
		if err := s.writeEvents(result); err != nil {
			return 0, 0, err
		}
	}
	return added, skipped, nil
}

// ImportDeadlines mirrors ImportEvents for deadlines.
func (s *Store) ImportDeadlines(candidates []model.Deadline) (added int, skipped int, err error) {
	existing, err := s.GetDeadlines()
	if err != nil {
		return 0, 0, err
	}
	seen := make(map[string]bool, len(existing)+len(candidates))
	for _, d := range existing {
		seen[deadlineKey(d)] = true
	}
	result := existing
	for _, c := range candidates {
		k := deadlineKey(c)
		if seen[k] {
			skipped++
			continue
		}
		seen[k] = true
		c.ID = genID()
		result = append(result, c)
		added++
	}
	if added > 0 {
		if err := s.writeDeadlines(result); err != nil {
			return 0, 0, err
		}
	}
	return added, skipped, nil
}
