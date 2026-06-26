package store

import (
	"fmt"
	"strconv"
	"strings"

	"timeline-planner/internal/model"
)

const calendarSourcesFile = "calendar_sources.csv"

var calendarSourcesHeader = []string{"id", "name", "url", "event_type", "last_synced_at", "counts_as_working_day"}

func parseCalendarSourceRow(row []string) model.CalendarSource {
	src := model.CalendarSource{
		ID:        row[0],
		Name:      row[1],
		URL:       row[2],
		EventType: model.EventType(row[3]),
	}
	if len(row) >= 5 {
		src.LastSyncedAt = row[4]
	}
	if len(row) >= 6 {
		src.CountsAsWorkingDay = strings.EqualFold(strings.TrimSpace(row[5]), "true")
	}
	return src
}

func calendarSourceToRow(src model.CalendarSource) []string {
	return []string{src.ID, src.Name, src.URL, string(src.EventType), src.LastSyncedAt, strconv.FormatBool(src.CountsAsWorkingDay)}
}

func (s *Store) GetCalendarSources() ([]model.CalendarSource, error) {
	rows, err := s.readCSV(calendarSourcesFile)
	if err != nil {
		return nil, err
	}
	var sources []model.CalendarSource
	for i, row := range rows {
		if i == 0 || len(row) < 4 {
			continue
		}
		sources = append(sources, parseCalendarSourceRow(row))
	}
	if sources == nil {
		return []model.CalendarSource{}, nil
	}
	return sources, nil
}

func (s *Store) CreateCalendarSource(src model.CalendarSource) error {
	sources, err := s.GetCalendarSources()
	if err != nil {
		return err
	}
	sources = append(sources, src)
	return s.writeCalendarSources(sources)
}

func (s *Store) UpdateCalendarSource(id string, src model.CalendarSource) error {
	sources, err := s.GetCalendarSources()
	if err != nil {
		return err
	}
	for i, existing := range sources {
		if existing.ID == id {
			src.ID = id
			sources[i] = src
			return s.writeCalendarSources(sources)
		}
	}
	return fmt.Errorf("calendar source %s not found", id)
}

func (s *Store) DeleteCalendarSource(id string) error {
	sources, err := s.GetCalendarSources()
	if err != nil {
		return err
	}
	filtered := make([]model.CalendarSource, 0, len(sources))
	for _, src := range sources {
		if src.ID != id {
			filtered = append(filtered, src)
		}
	}
	if len(filtered) == len(sources) {
		return fmt.Errorf("calendar source %s not found", id)
	}
	return s.writeCalendarSources(filtered)
}

func (s *Store) writeCalendarSources(sources []model.CalendarSource) error {
	rows := make([][]string, len(sources))
	for i, src := range sources {
		rows[i] = calendarSourceToRow(src)
	}
	return s.writeCSV(calendarSourcesFile, calendarSourcesHeader, rows)
}
