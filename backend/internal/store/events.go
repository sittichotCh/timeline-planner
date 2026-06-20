package store

import (
	"crypto/rand"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"timeline-planner/internal/model"
)

const eventsFile = "events.csv"

var eventsHeader = []string{"id", "member_emails", "scope", "type", "title", "start_date", "end_date", "counts_as_working_day", "source", "source_id", "external_uid"}

func genID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}
	return fmt.Sprintf("%x", b)
}

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

func joinEmails(emails []string) string {
	return strings.Join(emails, "|")
}

func parseEventRow(row []string) model.Event {
	e := model.Event{
		ID:           row[0],
		MemberEmails: parseEmails(row[1]),
		Scope:        model.EventScope(row[2]),
		Type:         model.EventType(row[3]),
		Title:        row[4],
		StartDate:    row[5],
		EndDate:      row[6],
	}
	if len(row) >= 8 {
		e.CountsAsWorkingDay = strings.EqualFold(strings.TrimSpace(row[7]), "true")
	}
	if len(row) >= 9 {
		e.Source = strings.TrimSpace(row[8])
	}
	if len(row) >= 10 {
		e.SourceID = strings.TrimSpace(row[9])
	}
	if len(row) >= 11 {
		e.ExternalUID = strings.TrimSpace(row[10])
	}
	if e.Source == "" {
		e.Source = model.SourceManual
	}
	return e
}

func eventToRow(e model.Event) []string {
	source := e.Source
	if source == "" {
		source = model.SourceManual
	}
	return []string{e.ID, joinEmails(e.MemberEmails), string(e.Scope), string(e.Type), e.Title, e.StartDate, e.EndDate, strconv.FormatBool(e.CountsAsWorkingDay), source, e.SourceID, e.ExternalUID}
}

func (s *Store) GetEvents() ([]model.Event, error) {
	rows, err := s.readCSV(eventsFile)
	if err != nil {
		return nil, err
	}
	var events []model.Event
	needsSave := false
	for i, row := range rows {
		if i == 0 || len(row) < 7 {
			continue
		}
		e := parseEventRow(row)
		if e.ID == "" {
			e.ID = genID()
			needsSave = true
		}
		if e.Scope == "" {
			e.Scope = model.ScopePersonal
			needsSave = true
		}
		if migrated := model.NormalizeEventType(e.Type); migrated != e.Type {
			e.Type = migrated
			needsSave = true
		}
		if title, ok := model.CanonicalTitle(e.Type); ok && e.Title != title {
			e.Title = title
			needsSave = true
		}
		events = append(events, e)
	}
	if needsSave && len(events) > 0 {
		_ = s.writeEvents(events)
	}
	if events == nil {
		return []model.Event{}, nil
	}
	return events, nil
}

func (s *Store) GetEventsByMember(email string) ([]model.Event, error) {
	events, err := s.GetEvents()
	if err != nil {
		return nil, err
	}
	var filtered []model.Event
	for _, e := range events {
		if slices.Contains(e.MemberEmails, email) {
			filtered = append(filtered, e)
		}
	}
	return filtered, nil
}

func (s *Store) CreateEvent(e model.Event) error {
	if title, ok := model.CanonicalTitle(e.Type); ok {
		e.Title = title
	}
	events, err := s.GetEvents()
	if err != nil {
		return err
	}
	events = append(events, e)
	return s.writeEvents(events)
}

func (s *Store) UpdateEvent(id string, e model.Event) error {
	if title, ok := model.CanonicalTitle(e.Type); ok {
		e.Title = title
	}
	events, err := s.GetEvents()
	if err != nil {
		return err
	}
	for i, existing := range events {
		if existing.ID == id {
			e.ID = id
			events[i] = e
			return s.writeEvents(events)
		}
	}
	return fmt.Errorf("event %s not found", id)
}

func (s *Store) DeleteEvent(id string) error {
	events, err := s.GetEvents()
	if err != nil {
		return err
	}
	filtered := make([]model.Event, 0, len(events))
	for _, e := range events {
		if e.ID != id {
			filtered = append(filtered, e)
		}
	}
	if len(filtered) == len(events) {
		return fmt.Errorf("event %s not found", id)
	}
	return s.writeEvents(filtered)
}

func (s *Store) writeEvents(events []model.Event) error {
	rows := make([][]string, len(events))
	for i, e := range events {
		rows[i] = eventToRow(e)
	}
	return s.writeCSV(eventsFile, eventsHeader, rows)
}
