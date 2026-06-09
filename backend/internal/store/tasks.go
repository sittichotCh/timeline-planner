package store

import (
	"fmt"
	"sort"
	"strconv"

	"timeline-planner/internal/model"
)

const tasksFile = "tasks.csv"

var tasksHeader = []string{"task_id", "summary", "priority", "status", "member_email", "start_date", "effort", "deadline_id", "rank", "plan_status"}

// effortDaysFromScale converts a (effort, time_scale) pair from the legacy CSV
// format to a number of working days. Mirrors the frontend's old effortToDays.
func effortDaysFromScale(effort float64, scale string) float64 {
	switch scale {
	case "week":
		return effort * 5
	case "month":
		return effort * 20
	case "sprint":
		return effort * 10
	default: // "day" or empty
		return effort
	}
}

func parseTaskRow(header []string, row []string) model.TaskSetting {
	idx := make(map[string]int, len(header))
	for i, h := range header {
		idx[h] = i
	}
	get := func(name string) string {
		if i, ok := idx[name]; ok && i < len(row) {
			return row[i]
		}
		return ""
	}
	effort, _ := strconv.ParseFloat(get("effort"), 64)
	if scale := get("time_scale"); scale != "" {
		effort = effortDaysFromScale(effort, scale)
	}
	rank, _ := strconv.Atoi(get("rank"))
	planStatus := get("plan_status")
	if planStatus == "" {
		planStatus = "OPEN"
	}
	return model.TaskSetting{
		TaskID:      get("task_id"),
		Summary:     get("summary"),
		Priority:    get("priority"),
		Status:      get("status"),
		MemberEmail: get("member_email"),
		StartDate:   get("start_date"),
		Effort:      effort,
		DeadlineID:  get("deadline_id"),
		Rank:        rank,
		PlanStatus:  planStatus,
	}
}

func taskToRow(t model.TaskSetting) []string {
	planStatus := t.PlanStatus
	if planStatus == "" {
		planStatus = "OPEN"
	}
	return []string{t.TaskID, t.Summary, t.Priority, t.Status, t.MemberEmail, t.StartDate, strconv.FormatFloat(t.Effort, 'g', -1, 64), t.DeadlineID, strconv.Itoa(t.Rank), planStatus}
}

func sortTasksByRank(tasks []model.TaskSetting) {
	sort.SliceStable(tasks, func(i, j int) bool {
		ri, rj := tasks[i].Rank, tasks[j].Rank
		if ri == 0 && rj != 0 {
			return false
		}
		if rj == 0 && ri != 0 {
			return true
		}
		return ri < rj
	})
}

func (s *Store) GetTaskSettings() ([]model.TaskSetting, error) {
	rows, err := s.readCSV(tasksFile)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return []model.TaskSetting{}, nil
	}
	header := rows[0]
	var tasks []model.TaskSetting
	for i, row := range rows {
		if i == 0 {
			continue
		}
		if len(row) == 0 {
			continue
		}
		tasks = append(tasks, parseTaskRow(header, row))
	}
	if tasks == nil {
		return []model.TaskSetting{}, nil
	}
	sortTasksByRank(tasks)
	normalized := normalizeRanks(tasks)
	migrated := headerNeedsMigration(header)
	if normalized || migrated {
		_ = s.writeTasks(tasks)
	}
	return tasks, nil
}

func headerNeedsMigration(header []string) bool {
	if len(header) != len(tasksHeader) {
		return true
	}
	for i, h := range header {
		if h != tasksHeader[i] {
			return true
		}
	}
	return false
}

// normalizeRanks assigns sequential ranks to any tasks with rank=0, placing them
// after the highest existing rank in their stable (post-sort) order. Returns true
// if any rank was changed.
func normalizeRanks(tasks []model.TaskSetting) bool {
	maxRank := 0
	for _, t := range tasks {
		if t.Rank > maxRank {
			maxRank = t.Rank
		}
	}
	changed := false
	for i := range tasks {
		if tasks[i].Rank == 0 {
			maxRank++
			tasks[i].Rank = maxRank
			changed = true
		}
	}
	return changed
}

func (s *Store) GetTaskSettingsByMember(email string) ([]model.TaskSetting, error) {
	tasks, err := s.GetTaskSettings()
	if err != nil {
		return nil, err
	}
	var filtered []model.TaskSetting
	for _, t := range tasks {
		if t.MemberEmail == email {
			filtered = append(filtered, t)
		}
	}
	return filtered, nil
}

func (s *Store) UpsertTaskSetting(t model.TaskSetting) (model.TaskSetting, error) {
	tasks, err := s.GetTaskSettings()
	if err != nil {
		return t, err
	}
	existingIdx := -1
	for i, existing := range tasks {
		if existing.TaskID == t.TaskID {
			existingIdx = i
			break
		}
	}

	if existingIdx >= 0 {
		oldRank := tasks[existingIdx].Rank
		newRank := t.Rank
		if newRank == 0 {
			newRank = oldRank
		}
		if newRank > len(tasks) {
			newRank = len(tasks)
		}
		if newRank < 1 {
			newRank = 1
		}
		if newRank != oldRank {
			for i := range tasks {
				if i == existingIdx {
					continue
				}
				r := tasks[i].Rank
				if newRank > oldRank && r > oldRank && r <= newRank {
					tasks[i].Rank = r - 1
				} else if newRank < oldRank && r >= newRank && r < oldRank {
					tasks[i].Rank = r + 1
				}
			}
		}
		t.Rank = newRank
		tasks[existingIdx] = t
		if err := s.writeTasks(tasks); err != nil {
			return t, err
		}
		return t, nil
	}

	insertRank := t.Rank
	if insertRank <= 0 || insertRank > len(tasks)+1 {
		insertRank = len(tasks) + 1
	} else {
		for i := range tasks {
			if tasks[i].Rank >= insertRank {
				tasks[i].Rank++
			}
		}
	}
	t.Rank = insertRank
	tasks = append(tasks, t)
	if err := s.writeTasks(tasks); err != nil {
		return t, err
	}
	return t, nil
}

func (s *Store) DeleteTaskSetting(taskID string) error {
	tasks, err := s.GetTaskSettings()
	if err != nil {
		return err
	}
	filtered := make([]model.TaskSetting, 0, len(tasks))
	for _, t := range tasks {
		if t.TaskID != taskID {
			filtered = append(filtered, t)
		}
	}
	if len(filtered) == len(tasks) {
		return fmt.Errorf("task setting %s not found", taskID)
	}
	return s.writeTasks(filtered)
}

func (s *Store) ReorderTaskSettings(ranks map[string]int) error {
	tasks, err := s.GetTaskSettings()
	if err != nil {
		return err
	}
	for i := range tasks {
		if newRank, ok := ranks[tasks[i].TaskID]; ok {
			tasks[i].Rank = newRank
		}
	}
	return s.writeTasks(tasks)
}

func (s *Store) writeTasks(tasks []model.TaskSetting) error {
	rows := make([][]string, len(tasks))
	for i, t := range tasks {
		rows[i] = taskToRow(t)
	}
	return s.writeCSV(tasksFile, tasksHeader, rows)
}
