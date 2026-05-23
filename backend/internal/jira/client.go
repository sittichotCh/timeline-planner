package jira

import (
	"fmt"

	"github.com/go-resty/resty/v2"
)

type Client struct {
	http *resty.Client
}

func NewClient(baseURL, email, token string) *Client {
	r := resty.New().
		SetBaseURL(baseURL).
		SetBasicAuth(email, token).
		SetHeader("Accept", "application/json")

	return &Client{http: r}
}

func (c *Client) BaseURL() string {
	return c.http.BaseURL
}

type Issue struct {
	Key    string      `json:"key"`
	Fields IssueFields `json:"fields"`
}

type IssueFields struct {
	Summary  string    `json:"summary"`
	Assignee *Assignee `json:"assignee"`
	Status   *Status   `json:"status"`
	Priority *Priority `json:"priority"`
}

type Assignee struct {
	Email       string `json:"emailAddress"`
	DisplayName string `json:"displayName"`
}

type Status struct {
	Name string `json:"name"`
}

type Priority struct {
	Name string `json:"name"`
}

type SearchResult struct {
	Issues        []Issue `json:"issues"`
	Total         int     `json:"total"`
	NextPageToken string  `json:"nextPageToken,omitempty"`
}

type searchResponse struct {
	Issues        []Issue `json:"issues"`
	Total         int     `json:"total"`
	NextPageToken string  `json:"nextPageToken"`
}

type searchRequest struct {
	JQL           string   `json:"jql"`
	MaxResults    int      `json:"maxResults"`
	Fields        []string `json:"fields"`
	NextPageToken string   `json:"nextPageToken,omitempty"`
}

func (c *Client) SearchIssues(jql string, maxResults int, nextPageToken string) (*SearchResult, error) {
	if c.http.BaseURL == "" {
		return nil, fmt.Errorf("jira base URL not configured")
	}

	body := searchRequest{
		JQL:        jql,
		MaxResults: maxResults,
		Fields:     []string{"summary", "assignee", "status", "priority"},
	}
	if nextPageToken != "" {
		body.NextPageToken = nextPageToken
	}

	var result searchResponse
	resp, err := c.http.R().
		SetBody(body).
		SetResult(&result).
		Post("/rest/api/3/search/jql")

	if err != nil {
		return nil, err
	}

	if resp.IsError() {
		return nil, fmt.Errorf("jira API returned %d: %s", resp.StatusCode(), resp.String())
	}

	return &SearchResult{
		Issues:        result.Issues,
		Total:         result.Total,
		NextPageToken: result.NextPageToken,
	}, nil
}
