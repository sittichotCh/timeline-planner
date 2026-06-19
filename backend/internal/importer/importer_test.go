package importer

import (
	"strings"
	"testing"
)

func TestParseRowsValid(t *testing.T) {
	csv := "title,start_date,end_date\n" +
		"Regression,2026-05-25,2026-05-29\n" +
		"Release,2026-08-03,\n" // blank end_date allowed
	rows, rowErrs, err := ParseRows(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(rowErrs) != 0 {
		t.Fatalf("unexpected row errors: %v", rowErrs)
	}
	if len(rows) != 2 {
		t.Fatalf("want 2 rows, got %d", len(rows))
	}
	if rows[0] != (Row{Title: "Regression", StartDate: "2026-05-25", EndDate: "2026-05-29"}) {
		t.Errorf("row0 unexpected: %+v", rows[0])
	}
	if rows[1].EndDate != "" {
		t.Errorf("row1 end_date should be blank, got %q", rows[1].EndDate)
	}
}

func TestParseRowsHeaderOrderAndExtraColumns(t *testing.T) {
	csv := "note,end_date,title,start_date\n" +
		"ignored,2026-06-02,Demo,2026-06-01\n"
	rows, rowErrs, err := ParseRows(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(rowErrs) != 0 {
		t.Fatalf("row errs: %v", rowErrs)
	}
	if len(rows) != 1 || rows[0].Title != "Demo" || rows[0].StartDate != "2026-06-01" || rows[0].EndDate != "2026-06-02" {
		t.Fatalf("unexpected: %+v", rows)
	}
}

func TestParseRowsNoEndDateColumn(t *testing.T) {
	csv := "title,start_date\n" +
		"Ship,2026-08-03\n"
	rows, rowErrs, err := ParseRows(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(rowErrs) != 0 {
		t.Fatalf("row errs: %v", rowErrs)
	}
	if len(rows) != 1 || rows[0].EndDate != "" {
		t.Fatalf("unexpected: %+v", rows)
	}
}

func TestParseRowsSkipsBlankRows(t *testing.T) {
	csv := "title,start_date,end_date\n" +
		",,\n" +
		"X,2026-06-01,2026-06-02\n"
	rows, rowErrs, err := ParseRows(strings.NewReader(csv))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(rowErrs) != 0 {
		t.Fatalf("blank row must not error: %v", rowErrs)
	}
	if len(rows) != 1 {
		t.Fatalf("want 1 row, got %d", len(rows))
	}
}

func TestParseRowsRowErrors(t *testing.T) {
	cases := []struct {
		name string
		row  string
		want string
	}{
		{"missing title", ",2026-06-01,2026-06-02", "title is required"},
		{"bad start", "X,2026-13-40,2026-06-02", "invalid start_date"},
		{"bad end when present", "X,2026-06-01,nope", "invalid end_date"},
	}
	header := "title,start_date,end_date\n"
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rows, rowErrs, err := ParseRows(strings.NewReader(header + tc.row + "\n"))
			if err != nil {
				t.Fatalf("unexpected fatal err: %v", err)
			}
			if len(rows) != 0 {
				t.Fatalf("expected no valid rows, got %d", len(rows))
			}
			if len(rowErrs) != 1 || rowErrs[0].Row != 2 {
				t.Fatalf("expected 1 error on line 2, got %+v", rowErrs)
			}
			if !strings.Contains(rowErrs[0].Reason, tc.want) {
				t.Errorf("reason %q does not contain %q", rowErrs[0].Reason, tc.want)
			}
		})
	}
}

func TestParseRowsFatalErrors(t *testing.T) {
	if _, _, err := ParseRows(strings.NewReader("")); err == nil {
		t.Error("expected error for empty file")
	}
	if _, _, err := ParseRows(strings.NewReader("title\nX\n")); err == nil {
		t.Error("expected error for missing start_date header")
	}
	if _, _, err := ParseRows(strings.NewReader("start_date,end_date\n2026-01-01,2026-01-02\n")); err == nil {
		t.Error("expected error for missing title header")
	}
}
