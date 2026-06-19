package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"timeline-planner/internal/store"

	"github.com/gin-gonic/gin"
)

func newImportRouter(t *testing.T) (*gin.Engine, *store.Store) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	s, err := store.New(t.TempDir())
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	r := gin.New()
	imp := NewImport(s)
	r.POST("/api/import/preview", imp.Preview)
	r.POST("/api/import", imp.Commit)
	return r, s
}

func multipartCSV(t *testing.T, content string) (*bytes.Buffer, string) {
	t.Helper()
	body := &bytes.Buffer{}
	w := multipart.NewWriter(body)
	fw, err := w.CreateFormFile("file", "import.csv")
	if err != nil {
		t.Fatalf("CreateFormFile: %v", err)
	}
	if _, err := fw.Write([]byte(content)); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	return body, w.FormDataContentType()
}

func postJSON(t *testing.T, r *gin.Engine, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func TestPreviewHappyPath(t *testing.T) {
	r, _ := newImportRouter(t)
	csv := "title,start_date,end_date\n" +
		"Regression,2026-05-25,2026-05-29\n" +
		"Bad,2026-13-99,2026-05-30\n" // bad start -> error on line 3
	body, ct := multipartCSV(t, csv)
	req := httptest.NewRequest(http.MethodPost, "/api/import/preview", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp previewResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(resp.Rows) != 1 || resp.Rows[0].Title != "Regression" {
		t.Errorf("rows unexpected: %+v", resp.Rows)
	}
	if len(resp.Errors) != 1 || resp.Errors[0].Row != 3 {
		t.Errorf("expected 1 error on row 3, got %+v", resp.Errors)
	}
}

func TestPreviewMissingFile400(t *testing.T) {
	r, _ := newImportRouter(t)
	req := httptest.NewRequest(http.MethodPost, "/api/import/preview", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; want 400", rec.Code)
	}
}

func TestPreviewMissingHeader400(t *testing.T) {
	r, _ := newImportRouter(t)
	body, ct := multipartCSV(t, "title\nX\n") // no start_date column
	req := httptest.NewRequest(http.MethodPost, "/api/import/preview", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; want 400", rec.Code)
	}
}

func TestCommitMixedHappyPath(t *testing.T) {
	r, s := newImportRouter(t)
	body := `{
		"events":[{"member_emails":["a@co.com"],"scope":"personal","type":"other","title":"Regression","start_date":"2026-05-25","end_date":"2026-05-29","counts_as_working_day":true}],
		"deadlines":[{"title":"Release","date":"2026-08-03","color":"violet"}]
	}`
	rec := postJSON(t, r, "/api/import", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp commitResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.ImportedEvents != 1 || resp.ImportedDeadlines != 1 {
		t.Errorf("imported events=%d deadlines=%d; want 1,1", resp.ImportedEvents, resp.ImportedDeadlines)
	}
	events, _ := s.GetEvents()
	if len(events) != 1 || events[0].Type != "other" || !events[0].CountsAsWorkingDay || len(events[0].MemberEmails) != 1 {
		t.Errorf("event not stored as posted: %+v", events)
	}
	deadlines, _ := s.GetDeadlines()
	if len(deadlines) != 1 || deadlines[0].Color != "violet" {
		t.Errorf("deadline not stored as posted: %+v", deadlines)
	}
}

func TestCommitTeamScopeEmptiesMembers(t *testing.T) {
	r, s := newImportRouter(t)
	body := `{"events":[{"member_emails":["a@co.com"],"scope":"team","type":"holiday","title":"Offsite","start_date":"2026-06-01","end_date":"2026-06-01","counts_as_working_day":false}],"deadlines":[]}`
	rec := postJSON(t, r, "/api/import", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	events, _ := s.GetEvents()
	if len(events) != 1 || events[0].Scope != "team" || len(events[0].MemberEmails) != 0 {
		t.Errorf("team event should have no members: %+v", events)
	}
}

func TestCommitPersonalNoMembers400(t *testing.T) {
	r, _ := newImportRouter(t)
	body := `{"events":[{"member_emails":[],"scope":"personal","type":"other","title":"X","start_date":"2026-06-01","end_date":"2026-06-02","counts_as_working_day":false}],"deadlines":[]}`
	rec := postJSON(t, r, "/api/import", body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; want 400 (body %s)", rec.Code, rec.Body.String())
	}
}

func TestCommitInvalidType400(t *testing.T) {
	r, _ := newImportRouter(t)
	body := `{"events":[{"member_emails":["a@co.com"],"scope":"personal","type":"bogus","title":"X","start_date":"2026-06-01","end_date":"2026-06-02","counts_as_working_day":false}],"deadlines":[]}`
	rec := postJSON(t, r, "/api/import", body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; want 400", rec.Code)
	}
}

func TestCommitEndBeforeStart400(t *testing.T) {
	r, _ := newImportRouter(t)
	body := `{"events":[{"member_emails":["a@co.com"],"scope":"personal","type":"other","title":"X","start_date":"2026-06-05","end_date":"2026-06-01","counts_as_working_day":false}],"deadlines":[]}`
	rec := postJSON(t, r, "/api/import", body)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; want 400", rec.Code)
	}
}

func TestCommitDeadlineColorCoerced(t *testing.T) {
	r, s := newImportRouter(t)
	body := `{"events":[],"deadlines":[{"title":"Ship","date":"2026-08-03","color":"chartreuse"}]}`
	rec := postJSON(t, r, "/api/import", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	deadlines, _ := s.GetDeadlines()
	if len(deadlines) != 1 || deadlines[0].Color != "red" {
		t.Errorf("invalid color should coerce to red: %+v", deadlines)
	}
}
