package model

type TaskSetting struct {
	TaskID      string  `json:"task_id"`
	Summary     string  `json:"summary"`
	Priority    string  `json:"priority"`
	Status      string  `json:"status"`
	IssueType   string  `json:"issue_type"`
	MemberEmail string  `json:"member_email"`
	StartDate   string  `json:"start_date"`
	Effort      float64 `json:"effort"`
	DeadlineID  string  `json:"deadline_id"`
	Rank        int     `json:"rank"`
	PlanStatus  string  `json:"plan_status"`
}
