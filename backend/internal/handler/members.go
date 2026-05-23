package handler

import (
	"net/http"

	"timeline-planner/internal/model"
	"timeline-planner/internal/store"

	"github.com/gin-gonic/gin"
)

type Members struct {
	store *store.Store
}

func NewMembers(s *store.Store) *Members {
	return &Members{store: s}
}

func (h *Members) List(c *gin.Context) {
	members, err := h.store.GetMembers()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, members)
}

func (h *Members) Create(c *gin.Context) {
	var m model.Member
	if err := c.ShouldBindJSON(&m); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	saved, err := h.store.CreateMember(m)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, saved)
}

func (h *Members) Update(c *gin.Context) {
	email := c.Param("email")
	var m model.Member
	if err := c.ShouldBindJSON(&m); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	saved, err := h.store.UpdateMember(email, m)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, saved)
}

func (h *Members) Delete(c *gin.Context) {
	email := c.Param("email")
	if err := h.store.DeleteMember(email); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

type memberSeqEntry struct {
	Email string `json:"email"`
	Seq   int    `json:"seq"`
}

func (h *Members) Reorder(c *gin.Context) {
	var entries []memberSeqEntry
	if err := c.ShouldBindJSON(&entries); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	seqs := make(map[string]int, len(entries))
	for _, e := range entries {
		seqs[e.Email] = e.Seq
	}
	if err := h.store.ReorderMembers(seqs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}
