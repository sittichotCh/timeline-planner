package gcal

import (
	"fmt"

	"github.com/go-resty/resty/v2"
)

// Client fetches public iCal feeds. Read-only: it issues GETs only.
type Client struct {
	http *resty.Client
}

func NewClient() *Client {
	return &Client{http: resty.New().SetHeader("Accept", "text/calendar")}
}

// FetchFeed returns the raw iCal body at url.
func (c *Client) FetchFeed(url string) (string, error) {
	if url == "" {
		return "", fmt.Errorf("empty calendar feed URL")
	}
	resp, err := c.http.R().Get(url)
	if err != nil {
		return "", err
	}
	if resp.IsError() {
		return "", fmt.Errorf("calendar feed returned %d", resp.StatusCode())
	}
	return resp.String(), nil
}
