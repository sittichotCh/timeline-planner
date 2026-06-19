// Package importer parses a CSV of raw import rows (title and dates) into Row
// values for the per-row import editor. It performs no persistence, no kind
// assignment, and no duplicate detection (those are the caller's / store's job).
package importer

import (
	"encoding/csv"
	"fmt"
	"io"
	"strings"
	"time"
)

// RowError describes a single row that failed validation. Row is the 1-based
// CSV line number (the header is line 1, so the first data row is line 2).
type RowError struct {
	Row    int    `json:"row"`
	Reason string `json:"reason"`
}

// Row is one CSV data row: the raw fields the user supplies. The kind and every
// other attribute are chosen later, per row, in the import editor.
type Row struct {
	Title     string `json:"title"`
	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
}

const dateLayout = "2006-01-02"

// ParseRows reads a CSV with columns title, start_date and optional end_date.
// It returns the valid rows plus a RowError for every rejected row. A non-nil
// error is returned only for a structurally unusable file: unreadable, empty,
// or missing the required "title" or "start_date" header.
func ParseRows(r io.Reader) ([]Row, []RowError, error) {
	reader := csv.NewReader(r)
	reader.FieldsPerRecord = -1 // allow ragged rows; we index by header name
	records, err := reader.ReadAll()
	if err != nil {
		return nil, nil, fmt.Errorf("could not parse CSV: %w", err)
	}
	if len(records) == 0 {
		return nil, nil, fmt.Errorf("file is empty")
	}

	col := map[string]int{}
	for i, name := range records[0] {
		col[strings.ToLower(strings.TrimSpace(name))] = i
	}
	for _, name := range []string{"title", "start_date"} {
		if _, ok := col[name]; !ok {
			return nil, nil, fmt.Errorf("missing required column: %s", name)
		}
	}

	get := func(row []string, name string) string {
		i, ok := col[name]
		if !ok || i >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[i])
	}

	rows := []Row{}
	rowErrors := []RowError{}
	for i := 1; i < len(records); i++ {
		rec := records[i]
		line := i + 1 // 1-based; header is line 1
		if isBlankRow(rec) {
			continue
		}

		title := get(rec, "title")
		if title == "" {
			rowErrors = append(rowErrors, RowError{Row: line, Reason: "title is required"})
			continue
		}
		start := get(rec, "start_date")
		if !validDate(start) {
			rowErrors = append(rowErrors, RowError{Row: line, Reason: "invalid start_date: expected YYYY-MM-DD"})
			continue
		}
		end := get(rec, "end_date")
		if end != "" && !validDate(end) {
			rowErrors = append(rowErrors, RowError{Row: line, Reason: "invalid end_date: expected YYYY-MM-DD"})
			continue
		}

		rows = append(rows, Row{Title: title, StartDate: start, EndDate: end})
	}
	return rows, rowErrors, nil
}

func validDate(s string) bool {
	if s == "" {
		return false
	}
	_, err := time.Parse(dateLayout, s)
	return err == nil
}

func isBlankRow(row []string) bool {
	for _, c := range row {
		if strings.TrimSpace(c) != "" {
			return false
		}
	}
	return true
}
