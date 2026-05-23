package handler

import (
	"crypto/rand"
	"fmt"
	"net/http"

	"timeline-planner/internal/model"
	"timeline-planner/internal/store"

	"github.com/gin-gonic/gin"
)

func generateID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand unavailable: " + err.Error())
	}
	return fmt.Sprintf("%x", b)
}

type Events struct {
	store *store.Store
}

func NewEvents(s *store.Store) *Events {
	return &Events{store: s}
}

func (h *Events) List(c *gin.Context) {
	events, err := h.store.GetEvents()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, events)
}

func (h *Events) ListByMember(c *gin.Context) {
	email := c.Param("email")
	events, err := h.store.GetEventsByMember(email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, events)
}

func (h *Events) Create(c *gin.Context) {
	var e model.Event
	if err := c.ShouldBindJSON(&e); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if e.ID == "" {
		e.ID = generateID()
	}
	if e.Scope == "" {
		e.Scope = model.ScopePersonal
	}
	if err := h.store.CreateEvent(e); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, e)
}

func (h *Events) Update(c *gin.Context) {
	id := c.Param("id")
	var e model.Event
	if err := c.ShouldBindJSON(&e); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.store.UpdateEvent(id, e); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, e)
}

func (h *Events) Delete(c *gin.Context) {
	id := c.Param("id")
	if err := h.store.DeleteEvent(id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}
