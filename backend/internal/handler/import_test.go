package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"timeline-planner/internal/store"

	"github.com/gin-gonic/gin"
)

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

func TestImportUploadHappyPath(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s, err := store.New(t.TempDir())
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	r := gin.New()
	r.POST("/api/import", NewImport(s).Upload)

	csv := "event_type,title,start_date,end_date,member_emails,scope,type,color\n" +
		"event,Regression,2026-05-25,2026-05-29,a@co.com,personal,other,\n" +
		"deadline,Release,2026-08-03,,,,,blue\n" +
		"task,Bad,2026-01-01,2026-01-02,a@co.com,personal,other,\n"
	body, contentType := multipartCSV(t, csv)

	req := httptest.NewRequest(http.MethodPost, "/api/import", body)
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp importResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.ImportedEvents != 1 || resp.ImportedDeadlines != 1 {
		t.Errorf("imported events=%d deadlines=%d; want 1,1", resp.ImportedEvents, resp.ImportedDeadlines)
	}
	if len(resp.Errors) != 1 || resp.Errors[0].Row != 4 {
		t.Errorf("expected 1 error on row 4, got %+v", resp.Errors)
	}
}

func TestImportUploadMissingFile(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s, _ := store.New(t.TempDir())
	r := gin.New()
	r.POST("/api/import", NewImport(s).Upload)

	req := httptest.NewRequest(http.MethodPost, "/api/import", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d; want 400", rec.Code)
	}
}
