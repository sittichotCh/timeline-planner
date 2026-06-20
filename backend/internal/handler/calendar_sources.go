package handler

import (
	"net/http"
	"time"

	"timeline-planner/internal/gcal"
	"timeline-planner/internal/model"
	"timeline-planner/internal/store"

	"github.com/gin-gonic/gin"
)

type CalendarSources struct {
	store *store.Store
	fetch func(url string) (string, error)
}

func NewCalendarSources(s *store.Store) *CalendarSources {
	client := gcal.NewClient()
	return &CalendarSources{store: s, fetch: client.FetchFeed}
}

// SyncSourceResult is the per-source outcome of a sync.
type SyncSourceResult struct {
	SourceID string `json:"source_id"`
	Name     string `json:"name"`
	Added    int    `json:"added"`
	Updated  int    `json:"updated"`
	Removed  int    `json:"removed"`
	Skipped  int    `json:"skipped"`
	Error    string `json:"error,omitempty"`
}

// SyncResult is the aggregate outcome returned by SyncAll.
type SyncResult struct {
	Sources []SyncSourceResult `json:"sources"`
	Added   int                `json:"added"`
	Updated int                `json:"updated"`
	Removed int                `json:"removed"`
	Skipped int                `json:"skipped"`
}

func (h *CalendarSources) List(c *gin.Context) {
	sources, err := h.store.GetCalendarSources()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, sources)
}

func (h *CalendarSources) Create(c *gin.Context) {
	var src model.CalendarSource
	if err := c.ShouldBindJSON(&src); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if src.ID == "" {
		src.ID = generateID()
	}
	if err := h.store.CreateCalendarSource(src); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, src)
}

func (h *CalendarSources) Update(c *gin.Context) {
	id := c.Param("id")
	var src model.CalendarSource
	if err := c.ShouldBindJSON(&src); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.UpdateCalendarSource(id, src); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, src)
}

func (h *CalendarSources) Delete(c *gin.Context) {
	id := c.Param("id")
	if _, err := h.store.DeleteSyncedEventsBySource(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.DeleteCalendarSource(id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *CalendarSources) SyncAll(c *gin.Context) {
	sources, err := h.store.GetCalendarSources()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	members, err := h.store.GetMembers()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	known := make(map[string]bool, len(members))
	for _, m := range members {
		known[m.Email] = true
	}

	result := SyncResult{Sources: []SyncSourceResult{}}
	for _, src := range sources {
		sr := SyncSourceResult{SourceID: src.ID, Name: src.Name}

		feedURL, err := gcal.ResolveFeedURL(src.URL)
		if err != nil {
			sr.Error = err.Error()
			result.Sources = append(result.Sources, sr)
			continue
		}
		ics, err := h.fetch(feedURL)
		if err != nil {
			sr.Error = err.Error()
			result.Sources = append(result.Sources, sr)
			continue
		}
		events, skipped, err := gcal.BuildEvents(src, ics, known)
		if err != nil {
			sr.Error = err.Error()
			result.Sources = append(result.Sources, sr)
			continue
		}
		added, updated, removed, err := h.store.ReplaceSyncedEvents(src.ID, events)
		if err != nil {
			sr.Error = err.Error()
			result.Sources = append(result.Sources, sr)
			continue
		}

		src.LastSyncedAt = time.Now().UTC().Format(time.RFC3339)
		_ = h.store.UpdateCalendarSource(src.ID, src)

		sr.Added, sr.Updated, sr.Removed, sr.Skipped = added, updated, removed, skipped
		result.Added += added
		result.Updated += updated
		result.Removed += removed
		result.Skipped += skipped
		result.Sources = append(result.Sources, sr)
	}
	c.JSON(http.StatusOK, result)
}
