package store

import (
	"fmt"

	"timeline-planner/internal/model"
)

const deadlinesFile = "deadlines.csv"

var deadlinesHeader = []string{"id", "title", "date", "color"}

func parseDeadlineRow(row []string) model.Deadline {
	return model.Deadline{
		ID:    row[0],
		Title: row[1],
		Date:  row[2],
		Color: row[3],
	}
}

func deadlineToRow(d model.Deadline) []string {
	return []string{d.ID, d.Title, d.Date, d.Color}
}

func (s *Store) GetDeadlines() ([]model.Deadline, error) {
	rows, err := s.readCSV(deadlinesFile)
	if err != nil {
		return nil, err
	}
	var deadlines []model.Deadline
	for i, row := range rows {
		if i == 0 || len(row) < 4 {
			continue
		}
		deadlines = append(deadlines, parseDeadlineRow(row))
	}
	if deadlines == nil {
		return []model.Deadline{}, nil
	}
	return deadlines, nil
}

func (s *Store) CreateDeadline(d model.Deadline) error {
	deadlines, err := s.GetDeadlines()
	if err != nil {
		return err
	}
	deadlines = append(deadlines, d)
	return s.writeDeadlines(deadlines)
}

func (s *Store) UpdateDeadline(id string, d model.Deadline) error {
	deadlines, err := s.GetDeadlines()
	if err != nil {
		return err
	}
	for i, existing := range deadlines {
		if existing.ID == id {
			d.ID = id
			deadlines[i] = d
			return s.writeDeadlines(deadlines)
		}
	}
	return fmt.Errorf("deadline %s not found", id)
}

func (s *Store) DeleteDeadline(id string) error {
	deadlines, err := s.GetDeadlines()
	if err != nil {
		return err
	}
	filtered := make([]model.Deadline, 0, len(deadlines))
	for _, d := range deadlines {
		if d.ID != id {
			filtered = append(filtered, d)
		}
	}
	if len(filtered) == len(deadlines) {
		return fmt.Errorf("deadline %s not found", id)
	}
	return s.writeDeadlines(filtered)
}

func (s *Store) writeDeadlines(deadlines []model.Deadline) error {
	rows := make([][]string, len(deadlines))
	for i, d := range deadlines {
		rows[i] = deadlineToRow(d)
	}
	return s.writeCSV(deadlinesFile, deadlinesHeader, rows)
}
