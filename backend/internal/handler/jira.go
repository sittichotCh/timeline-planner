package handler

import (
	"net/http"

	"timeline-planner/internal/config"
	"timeline-planner/internal/jira"

	"github.com/gin-gonic/gin"
)

type Jira struct {
	client *jira.Client
}

func NewJira(cfg *config.Config) *Jira {
	return &Jira{
		client: jira.NewClient(cfg.JiraBaseURL, cfg.JiraEmail, cfg.JiraToken),
	}
}

type SyncRequest struct {
	JQL           string `json:"jql" binding:"required"`
	MaxResults    int    `json:"maxResults"`
	NextPageToken string `json:"nextPageToken"`
}

func (h *Jira) Config(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"baseUrl": h.client.BaseURL()})
}

func (h *Jira) Sync(c *gin.Context) {
	var req SyncRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.MaxResults <= 0 {
		req.MaxResults = 20
	}

	result, err := h.client.SearchIssues(req.JQL, req.MaxResults, req.NextPageToken)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}
