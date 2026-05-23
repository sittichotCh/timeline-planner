package handler

import (
	"net/http"

	"timeline-planner/internal/model"
	"timeline-planner/internal/store"

	"github.com/gin-gonic/gin"
)

type Deadlines struct {
	store *store.Store
}

func NewDeadlines(s *store.Store) *Deadlines {
	return &Deadlines{store: s}
}

func (h *Deadlines) List(c *gin.Context) {
	deadlines, err := h.store.GetDeadlines()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, deadlines)
}

func (h *Deadlines) Create(c *gin.Context) {
	var d model.Deadline
	if err := c.ShouldBindJSON(&d); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if d.ID == "" {
		d.ID = generateID()
	}
	if d.Color == "" {
		d.Color = "red"
	}
	if err := h.store.CreateDeadline(d); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, d)
}

func (h *Deadlines) Update(c *gin.Context) {
	id := c.Param("id")
	var d model.Deadline
	if err := c.ShouldBindJSON(&d); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.UpdateDeadline(id, d); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	d.ID = id
	c.JSON(http.StatusOK, d)
}

func (h *Deadlines) Delete(c *gin.Context) {
	id := c.Param("id")
	if err := h.store.DeleteDeadline(id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}
