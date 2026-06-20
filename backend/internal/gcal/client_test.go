package gcal

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFetchFeedEmptyURL(t *testing.T) {
	if _, err := NewClient().FetchFeed(""); err == nil {
		t.Errorf("want error for empty URL")
	}
}

func TestFetchFeedSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/calendar")
		_, _ = w.Write([]byte("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n"))
	}))
	defer srv.Close()

	body, err := NewClient().FetchFeed(srv.URL)
	if err != nil {
		t.Fatalf("FetchFeed: %v", err)
	}
	if body == "" {
		t.Errorf("want non-empty body")
	}
}

func TestFetchFeedHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	if _, err := NewClient().FetchFeed(srv.URL); err == nil {
		t.Errorf("want error for 404 response")
	}
}
