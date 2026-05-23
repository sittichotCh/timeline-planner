package handler

import (
	"net/http"

	"timeline-planner/internal/model"
	"timeline-planner/internal/store"

	"github.com/gin-gonic/gin"
)

type Tasks struct {
	store *store.Store
}

func NewTasks(s *store.Store) *Tasks {
	return &Tasks{store: s}
}

func (h *Tasks) List(c *gin.Context) {
	tasks, err := h.store.GetTaskSettings()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, tasks)
}

func (h *Tasks) ListByMember(c *gin.Context) {
	email := c.Param("email")
	tasks, err := h.store.GetTaskSettingsByMember(email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, tasks)
}

func (h *Tasks) Upsert(c *gin.Context) {
	var t model.TaskSetting
	if err := c.ShouldBindJSON(&t); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	saved, err := h.store.UpsertTaskSetting(t)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, saved)
}

func (h *Tasks) Delete(c *gin.Context) {
	taskID := c.Param("task_id")
	if err := h.store.DeleteTaskSetting(taskID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

type rankEntry struct {
	TaskID string `json:"task_id"`
	Rank   int    `json:"rank"`
}

func (h *Tasks) Reorder(c *gin.Context) {
	var entries []rankEntry
	if err := c.ShouldBindJSON(&entries); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ranks := make(map[string]int, len(entries))
	for _, e := range entries {
		ranks[e.TaskID] = e.Rank
	}
	if err := h.store.ReorderTaskSettings(ranks); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}
