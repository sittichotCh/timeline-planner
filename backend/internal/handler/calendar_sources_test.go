package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"timeline-planner/internal/model"
	"timeline-planner/internal/store"

	"github.com/gin-gonic/gin"
)

// fakeFeed is a tiny on-call feed: one known member, one unknown.
const fakeFeed = "BEGIN:VCALENDAR\r\n" +
	"X-WR-TIMEZONE:Asia/Bangkok\r\n" +
	"BEGIN:VEVENT\r\nDTSTART:20260412T050000Z\r\nDTEND:20260412T060000Z\r\nUID:u1@g\r\nSUMMARY:known@co.com\r\nEND:VEVENT\r\n" +
	"BEGIN:VEVENT\r\nDTSTART:20260413T050000Z\r\nDTEND:20260413T060000Z\r\nUID:u2@g\r\nSUMMARY:stranger@co.com\r\nEND:VEVENT\r\n" +
	"END:VCALENDAR\r\n"

func newCalendarRouter(t *testing.T) (*gin.Engine, *store.Store, *CalendarSources) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	s, err := store.New(t.TempDir())
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	h := &CalendarSources{store: s, fetch: func(string) (string, error) { return fakeFeed, nil }}
	r := gin.New()
	g := r.Group("/api/calendar-sources")
	g.GET("", h.List)
	g.POST("", h.Create)
	g.POST("/sync", h.SyncAll)
	g.PUT("/:id", h.Update)
	g.DELETE("/:id", h.Delete)
	return r, s, h
}

func do(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func TestCalendarSourceCreateAndList(t *testing.T) {
	r, _, _ := newCalendarRouter(t)
	rec := do(t, r, http.MethodPost, "/api/calendar-sources", `{"name":"On-call","url":"https://x/basic.ics","event_type":"oncall"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d (%s)", rec.Code, rec.Body.String())
	}
	var created model.CalendarSource
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	if created.ID == "" {
		t.Fatalf("server should assign an id")
	}
	rec = do(t, r, http.MethodGet, "/api/calendar-sources", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "On-call") {
		t.Fatalf("list failed: %d %s", rec.Code, rec.Body.String())
	}
}

func TestCalendarSyncAll(t *testing.T) {
	r, s, _ := newCalendarRouter(t)
	// A known member so one event matches; the other (stranger@co.com) is skipped.
	if _, err := s.CreateMember(model.Member{Email: "known@co.com", Name: "Known"}); err != nil {
		t.Fatalf("seed member: %v", err)
	}
	// Register a source.
	if err := s.CreateCalendarSource(model.CalendarSource{ID: "src1", Name: "On-call", URL: "https://x/basic.ics", EventType: model.EventOncall}); err != nil {
		t.Fatalf("seed source: %v", err)
	}

	rec := do(t, r, http.MethodPost, "/api/calendar-sources/sync", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("sync status = %d (%s)", rec.Code, rec.Body.String())
	}
	var result SyncResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if result.Added != 1 || result.Skipped != 1 {
		t.Fatalf("want added=1 skipped=1, got %+v", result)
	}
	// The matched event should now exist for the member.
	events, _ := s.GetEventsByMember("known@co.com")
	if len(events) != 1 || events[0].Source != model.SourceGoogle {
		t.Fatalf("want 1 synced event for member, got %+v", events)
	}

	// last_synced_at should be stamped.
	sources, _ := s.GetCalendarSources()
	if sources[0].LastSyncedAt == "" {
		t.Errorf("last_synced_at should be set after sync")
	}
}

func TestCalendarSourceDeletePrunesEvents(t *testing.T) {
	r, s, _ := newCalendarRouter(t)
	_, _, _, _ = s.ReplaceSyncedEvents("src1", []model.Event{{
		MemberEmails: []string{"known@co.com"}, Scope: model.ScopePersonal, Type: model.EventOncall,
		Title: "Oncall", StartDate: "2026-06-10", EndDate: "2026-06-10", ExternalUID: "u1@g",
	}})
	if err := s.CreateCalendarSource(model.CalendarSource{ID: "src1", Name: "On-call", URL: "x", EventType: model.EventOncall}); err != nil {
		t.Fatalf("seed source: %v", err)
	}
	rec := do(t, r, http.MethodDelete, "/api/calendar-sources/src1", "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d", rec.Code)
	}
	if events, _ := s.GetEvents(); len(events) != 0 {
		t.Fatalf("deleting a source should prune its events, got %+v", events)
	}
}
