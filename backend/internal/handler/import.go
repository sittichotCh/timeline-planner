package handler

import (
	"net/http"

	"timeline-planner/internal/importer"
	"timeline-planner/internal/store"

	"github.com/gin-gonic/gin"
)

type Import struct {
	store *store.Store
}

func NewImport(s *store.Store) *Import {
	return &Import{store: s}
}

type importResponse struct {
	ImportedEvents    int                 `json:"imported_events"`
	ImportedDeadlines int                 `json:"imported_deadlines"`
	SkippedDuplicates int                 `json:"skipped_duplicates"`
	Errors            []importer.RowError `json:"errors"`
}

// Upload handles POST /api/import: a multipart form with a "file" field
// containing the unified events/deadlines CSV.
func (h *Import) Upload(c *gin.Context) {
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

	events, deadlines, rowErrors, err := importer.Parse(f)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	addedEvents, skippedEvents, err := h.store.ImportEvents(events)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	addedDeadlines, skippedDeadlines, err := h.store.ImportDeadlines(deadlines)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if rowErrors == nil {
		rowErrors = []importer.RowError{}
	}
	c.JSON(http.StatusOK, importResponse{
		ImportedEvents:    addedEvents,
		ImportedDeadlines: addedDeadlines,
		SkippedDuplicates: skippedEvents + skippedDeadlines,
		Errors:            rowErrors,
	})
}
