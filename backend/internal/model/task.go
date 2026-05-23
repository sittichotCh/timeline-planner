package model

type TaskSetting struct {
	TaskID      string `json:"task_id"`
	Summary     string `json:"summary"`
	Priority    string `json:"priority"`
	Status      string `json:"status"`
	MemberEmail string `json:"member_email"`
	StartDate   string `json:"start_date"`
	Effort      int    `json:"effort"`
	DeadlineID  string `json:"deadline_id"`
	Rank        int    `json:"rank"`
}
