package jira

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/go-resty/resty/v2"
)

// devPointsFieldName is the Jira custom field whose value is mapped onto a
// task's effort. Matched case-insensitively against the field's display name.
const devPointsFieldName = "Dev points"

type Client struct {
	http *resty.Client

	mu          sync.Mutex
	devPointsID string // cached customfield id for "Dev points" ("" until resolved / not found)
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
	// DevPoints is the normalized value of the "Dev points" custom field,
	// surfaced under a stable key so the frontend never deals with the
	// instance-specific customfield_XXXXX id. Omitted when the field is unset.
	DevPoints *float64 `json:"dev_points,omitempty"`
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

// fieldMeta is one entry from GET /rest/api/3/field.
type fieldMeta struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// devPointsFieldID resolves and caches the custom field id whose name matches
// devPointsFieldName. Returns "" (no error) when the field doesn't exist on
// this Jira instance, so a missing field never breaks a sync.
func (c *Client) devPointsFieldID() (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.devPointsID != "" {
		return c.devPointsID, nil
	}

	var fields []fieldMeta
	resp, err := c.http.R().SetResult(&fields).Get("/rest/api/3/field")
	if err != nil {
		return "", err
	}
	if resp.IsError() {
		return "", fmt.Errorf("jira field lookup returned %d: %s", resp.StatusCode(), resp.String())
	}
	for _, f := range fields {
		if strings.EqualFold(f.Name, devPointsFieldName) {
			c.devPointsID = f.ID
			break
		}
	}
	return c.devPointsID, nil
}

// rawIssue keeps the fields blob raw so we can both decode the known typed
// fields and pull out the dynamically-named custom field.
type rawIssue struct {
	Key    string          `json:"key"`
	Fields json.RawMessage `json:"fields"`
}

type searchResponse struct {
	Issues        []rawIssue `json:"issues"`
	Total         int        `json:"total"`
	NextPageToken string     `json:"nextPageToken"`
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

	fields := []string{"summary", "assignee", "status", "priority"}
	// Best-effort: include the "Dev points" custom field when it exists so we
	// can map it onto task effort. A lookup failure must not break the sync.
	devID, _ := c.devPointsFieldID()
	if devID != "" {
		fields = append(fields, devID)
	}

	body := searchRequest{
		JQL:        jql,
		MaxResults: maxResults,
		Fields:     fields,
	}
	if nextPageToken != "" {
		body.NextPageToken = nextPageToken
	}

	var raw searchResponse
	resp, err := c.http.R().
		SetBody(body).
		SetResult(&raw).
		Post("/rest/api/3/search/jql")

	if err != nil {
		return nil, err
	}

	if resp.IsError() {
		return nil, fmt.Errorf("jira API returned %d: %s", resp.StatusCode(), resp.String())
	}

	issues := make([]Issue, 0, len(raw.Issues))
	for _, ri := range raw.Issues {
		var f IssueFields
		if len(ri.Fields) > 0 {
			_ = json.Unmarshal(ri.Fields, &f) // summary / assignee / status / priority
			if devID != "" {
				f.DevPoints = extractNumber(ri.Fields, devID)
			}
		}
		issues = append(issues, Issue{Key: ri.Key, Fields: f})
	}

	return &SearchResult{
		Issues:        issues,
		Total:         raw.Total,
		NextPageToken: raw.NextPageToken,
	}, nil
}

// extractNumber pulls a numeric custom-field value out of the raw fields blob.
// Jira number custom fields serialize as a bare JSON number; returns nil when
// the field is absent or not a number.
func extractNumber(rawFields json.RawMessage, fieldID string) *float64 {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(rawFields, &m); err != nil {
		return nil
	}
	raw, ok := m[fieldID]
	if !ok {
		return nil
	}
	// Decode into a pointer so an explicit JSON null (an unset field) stays nil
	// rather than collapsing to 0. Non-numeric shapes yield an error → nil.
	var n *float64
	if err := json.Unmarshal(raw, &n); err != nil {
		return nil
	}
	return n
}
