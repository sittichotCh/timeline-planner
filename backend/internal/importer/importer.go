// Package importer parses a unified CSV of events and deadlines into model
// values, applying per-row validation and defaults. It performs no
// persistence and no duplicate detection (those are the store's job).
package importer

import (
	"encoding/csv"
	"fmt"
	"io"
	"strings"
	"time"

	"timeline-planner/internal/model"
)

// RowError describes a single row that failed validation. Row is the 1-based
// CSV line number (the header is line 1, so the first data row is line 2).
type RowError struct {
	Row    int    `json:"row"`
	Reason string `json:"reason"`
}

const dateLayout = "2006-01-02"

var deadlineColors = map[string]bool{
	"red": true, "orange": true, "amber": true,
	"emerald": true, "blue": true, "violet": true,
}

// Parse reads a unified events/deadlines CSV from r. It returns the valid
// events and deadlines (normalized, without IDs) plus a RowError for every
// invalid row. A non-nil error is returned only for a structurally unusable
// file: unreadable, empty, or missing the required "event_type" header.
func Parse(r io.Reader) ([]model.Event, []model.Deadline, []RowError, error) {
	reader := csv.NewReader(r)
	reader.FieldsPerRecord = -1 // allow ragged rows; we index by header name
	records, err := reader.ReadAll()
	if err != nil {
		return nil, nil, nil, fmt.Errorf("could not parse CSV: %w", err)
	}
	if len(records) == 0 {
		return nil, nil, nil, fmt.Errorf("file is empty")
	}

	col := map[string]int{}
	for i, name := range records[0] {
		col[strings.ToLower(strings.TrimSpace(name))] = i
	}
	if _, ok := col["event_type"]; !ok {
		return nil, nil, nil, fmt.Errorf("missing required column: event_type")
	}

	get := func(row []string, name string) string {
		i, ok := col[name]
		if !ok || i >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[i])
	}

	events := []model.Event{}
	deadlines := []model.Deadline{}
	rowErrors := []RowError{}

	for i := 1; i < len(records); i++ {
		row := records[i]
		line := i + 1 // 1-based; header is line 1

		if isBlankRow(row) {
			continue
		}

		switch strings.ToLower(get(row, "event_type")) {
		case "event":
			e, reason := parseEvent(row, get)
			if reason != "" {
				rowErrors = append(rowErrors, RowError{Row: line, Reason: reason})
				continue
			}
			events = append(events, e)
		case "deadline":
			d, reason := parseDeadline(row, get)
			if reason != "" {
				rowErrors = append(rowErrors, RowError{Row: line, Reason: reason})
				continue
			}
			deadlines = append(deadlines, d)
		default:
			rowErrors = append(rowErrors, RowError{
				Row:    line,
				Reason: fmt.Sprintf("unknown event_type %q (expected \"event\" or \"deadline\")", get(row, "event_type")),
			})
		}
	}

	return events, deadlines, rowErrors, nil
}

type getter func(row []string, name string) string

func parseEvent(row []string, get getter) (model.Event, string) {
	start := get(row, "start_date")
	end := get(row, "end_date")
	if !validDate(start) {
		return model.Event{}, "invalid start_date: expected YYYY-MM-DD"
	}
	if !validDate(end) {
		return model.Event{}, "invalid end_date: expected YYYY-MM-DD"
	}
	if end < start { // safe: both are validated YYYY-MM-DD
		return model.Event{}, "end_date is before start_date"
	}

	scope := model.EventScope(strings.ToLower(get(row, "scope")))
	switch scope {
	case "":
		scope = model.ScopePersonal
	case model.ScopePersonal, model.ScopeTeam:
		// ok
	default:
		return model.Event{}, fmt.Sprintf("invalid scope %q (expected \"personal\" or \"team\")", get(row, "scope"))
	}

	rawType := model.EventType(strings.ToLower(get(row, "type")))
	if rawType == "" {
		rawType = model.EventOther
	}
	etype := model.NormalizeEventType(rawType)
	if !validEventType(etype) {
		return model.Event{}, fmt.Sprintf("unknown type %q", get(row, "type"))
	}

	title := get(row, "title")
	if canonical, ok := model.CanonicalTitle(etype); ok {
		title = canonical
	} else if title == "" {
		return model.Event{}, "title is required for type \"other\""
	}

	emails := parseEmails(get(row, "member_emails"))
	if scope == model.ScopePersonal && len(emails) == 0 {
		return model.Event{}, "member_emails is required for personal events"
	}

	return model.Event{
		MemberEmails: emails,
		Scope:        scope,
		Type:         etype,
		Title:        title,
		StartDate:    start,
		EndDate:      end,
	}, ""
}

func parseDeadline(row []string, get getter) (model.Deadline, string) {
	date := get(row, "start_date")
	if !validDate(date) {
		return model.Deadline{}, "invalid start_date: expected YYYY-MM-DD"
	}
	title := get(row, "title")
	if title == "" {
		return model.Deadline{}, "title is required"
	}
	color := strings.ToLower(get(row, "color"))
	if !deadlineColors[color] {
		color = "red"
	}
	return model.Deadline{Title: title, Date: date, Color: color}, ""
}

func validDate(s string) bool {
	if s == "" {
		return false
	}
	_, err := time.Parse(dateLayout, s)
	return err == nil
}

func validEventType(t model.EventType) bool {
	switch t {
	case model.EventLeave, model.EventOncall, model.EventHoliday, model.EventOther:
		return true
	}
	return false
}

func isBlankRow(row []string) bool {
	for _, c := range row {
		if strings.TrimSpace(c) != "" {
			return false
		}
	}
	return true
}

// parseEmails splits a pipe-delimited cell into trimmed, non-empty emails.
// Kept local to the importer to avoid coupling to the store's unexported copy.
func parseEmails(raw string) []string {
	if raw == "" {
		return []string{}
	}
	parts := strings.Split(raw, "|")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if s := strings.TrimSpace(p); s != "" {
			out = append(out, s)
		}
	}
	return out
}
