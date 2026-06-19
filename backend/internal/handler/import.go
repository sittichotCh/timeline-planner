package handler

import (
	"net/http"
	"strings"
	"time"

	"timeline-planner/internal/importer"
	"timeline-planner/internal/model"
	"timeline-planner/internal/store"

	"github.com/gin-gonic/gin"
)

type Import struct {
	store *store.Store
}

func NewImport(s *store.Store) *Import {
	return &Import{store: s}
}

type previewResponse struct {
	Rows   []importer.Row      `json:"rows"`
	Errors []importer.RowError `json:"errors"`
}

// Preview handles POST /api/import/preview: a multipart form with field "file".
// It parses the CSV into raw rows (title + dates) for the per-row editor.
func (h *Import) Preview(c *gin.Context) {
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a CSV file is required (form field \"file\")"})
		return
	}
	f, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "could not open uploaded file"})
		return
	}
	defer f.Close()

	rows, rowErrors, err := importer.ParseRows(f)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if rows == nil {
		rows = []importer.Row{}
	}
	if rowErrors == nil {
		rowErrors = []importer.RowError{}
	}
	c.JSON(http.StatusOK, previewResponse{Rows: rows, Errors: rowErrors})
}

type commitRequest struct {
	Events    []model.Event    `json:"events"`
	Deadlines []model.Deadline `json:"deadlines"`
}

type commitResponse struct {
	ImportedEvents    int                 `json:"imported_events"`
	ImportedDeadlines int                 `json:"imported_deadlines"`
	SkippedDuplicates int                 `json:"skipped_duplicates"`
	Errors            []importer.RowError `json:"errors"`
}

const dateLayout = "2006-01-02"

var deadlineColors = map[string]bool{
	"red": true, "orange": true, "amber": true,
	"emerald": true, "blue": true, "violet": true,
}

// Commit handles POST /api/import: a JSON body of finalized events and
// deadlines (no IDs). It validates each item, then batch-imports via the store.
func (h *Import) Commit(c *gin.Context) {
	var req commitRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	for i := range req.Events {
		if msg := validateEvent(&req.Events[i]); msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
	}
	for i := range req.Deadlines {
		if msg := validateDeadline(&req.Deadlines[i]); msg != "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": msg})
			return
		}
	}

	addedEvents, skippedEvents, err := h.store.ImportEvents(req.Events)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	addedDeadlines, skippedDeadlines, err := h.store.ImportDeadlines(req.Deadlines)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, commitResponse{
		ImportedEvents:    addedEvents,
		ImportedDeadlines: addedDeadlines,
		SkippedDuplicates: skippedEvents + skippedDeadlines,
		Errors:            []importer.RowError{},
	})
}

// validateEvent checks and normalizes one event; returns "" if valid, else a
// human-readable reason. Team scope forces an empty member list.
func validateEvent(e *model.Event) string {
	if e.Title == "" {
		return "event title is required"
	}
	if !validDate(e.StartDate) {
		return "event has an invalid start_date"
	}
	if !validDate(e.EndDate) {
		return "event has an invalid end_date"
	}
	if e.EndDate < e.StartDate { // safe: both are validated YYYY-MM-DD
		return "event end_date is before start_date"
	}
	switch e.Scope {
	case model.ScopePersonal:
		if len(e.MemberEmails) == 0 {
			return "personal event requires at least one member"
		}
	case model.ScopeTeam:
		e.MemberEmails = []string{}
	default:
		return "event scope must be \"personal\" or \"team\""
	}
	switch e.Type {
	case model.EventLeave, model.EventOncall, model.EventHoliday, model.EventOther:
		// ok
	default:
		return "event type must be leave, oncall, holiday, or other"
	}
	return ""
}

// validateDeadline checks and normalizes one deadline; returns "" if valid.
// A blank or unknown color is coerced to "red".
func validateDeadline(d *model.Deadline) string {
	if d.Title == "" {
		return "deadline title is required"
	}
	if !validDate(d.Date) {
		return "deadline has an invalid date"
	}
	if !deadlineColors[strings.ToLower(strings.TrimSpace(d.Color))] {
		d.Color = "red"
	}
	return ""
}

func validDate(s string) bool {
	if s == "" {
		return false
	}
	_, err := time.Parse(dateLayout, s)
	return err == nil
}
