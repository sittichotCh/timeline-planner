package store

import (
	"fmt"
	"sort"
	"strconv"
	"time"

	"timeline-planner/internal/model"
)

const membersFile = "members.csv"

var membersHeader = []string{"email", "name", "role", "avatar_url", "created_at", "seq"}

func parseMemberRow(header []string, row []string) model.Member {
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
	t, _ := time.Parse(time.RFC3339, get("created_at"))
	seq, _ := strconv.Atoi(get("seq"))
	return model.Member{
		Email:     get("email"),
		Name:      get("name"),
		Role:      get("role"),
		AvatarURL: get("avatar_url"),
		CreatedAt: t,
		Seq:       seq,
	}
}

func memberToRow(m model.Member) []string {
	return []string{m.Email, m.Name, m.Role, m.AvatarURL, m.CreatedAt.Format(time.RFC3339), strconv.Itoa(m.Seq)}
}

func sortMembersBySeq(members []model.Member) {
	sort.SliceStable(members, func(i, j int) bool {
		si, sj := members[i].Seq, members[j].Seq
		if si == 0 && sj != 0 {
			return false
		}
		if sj == 0 && si != 0 {
			return true
		}
		return si < sj
	})
}

func normalizeMemberSeqs(members []model.Member) bool {
	maxSeq := 0
	for _, m := range members {
		if m.Seq > maxSeq {
			maxSeq = m.Seq
		}
	}
	changed := false
	for i := range members {
		if members[i].Seq == 0 {
			maxSeq++
			members[i].Seq = maxSeq
			changed = true
		}
	}
	return changed
}

func membersHeaderNeedsMigration(header []string) bool {
	if len(header) != len(membersHeader) {
		return true
	}
	for i, h := range header {
		if h != membersHeader[i] {
			return true
		}
	}
	return false
}

func (s *Store) GetMembers() ([]model.Member, error) {
	rows, err := s.readCSV(membersFile)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return []model.Member{}, nil
	}
	header := rows[0]
	var members []model.Member
	for i, row := range rows {
		if i == 0 || len(row) == 0 {
			continue
		}
		members = append(members, parseMemberRow(header, row))
	}
	if members == nil {
		return []model.Member{}, nil
	}
	sortMembersBySeq(members)
	normalized := normalizeMemberSeqs(members)
	migrated := membersHeaderNeedsMigration(header)
	if normalized || migrated {
		_ = s.writeMembers(members)
	}
	return members, nil
}

func (s *Store) CreateMember(m model.Member) (model.Member, error) {
	members, err := s.GetMembers()
	if err != nil {
		return m, err
	}
	for _, existing := range members {
		if existing.Email == m.Email {
			return m, fmt.Errorf("member with email %s already exists", m.Email)
		}
	}
	m.CreatedAt = time.Now().UTC()
	if m.Seq == 0 {
		maxSeq := 0
		for _, existing := range members {
			if existing.Seq > maxSeq {
				maxSeq = existing.Seq
			}
		}
		m.Seq = maxSeq + 1
	}
	members = append(members, m)
	if err := s.writeMembers(members); err != nil {
		return m, err
	}
	return m, nil
}

func (s *Store) UpdateMember(email string, m model.Member) (model.Member, error) {
	members, err := s.GetMembers()
	if err != nil {
		return m, err
	}
	for i, existing := range members {
		if existing.Email == email {
			m.CreatedAt = existing.CreatedAt
			m.Email = email
			if m.Seq == 0 {
				m.Seq = existing.Seq
			}
			members[i] = m
			if err := s.writeMembers(members); err != nil {
				return m, err
			}
			return m, nil
		}
	}
	return m, fmt.Errorf("member %s not found", email)
}

func (s *Store) DeleteMember(email string) error {
	members, err := s.GetMembers()
	if err != nil {
		return err
	}
	filtered := make([]model.Member, 0, len(members))
	for _, m := range members {
		if m.Email != email {
			filtered = append(filtered, m)
		}
	}
	if len(filtered) == len(members) {
		return fmt.Errorf("member %s not found", email)
	}
	return s.writeMembers(filtered)
}

func (s *Store) ReorderMembers(seqs map[string]int) error {
	members, err := s.GetMembers()
	if err != nil {
		return err
	}
	for i := range members {
		if newSeq, ok := seqs[members[i].Email]; ok {
			members[i].Seq = newSeq
		}
	}
	return s.writeMembers(members)
}

func (s *Store) writeMembers(members []model.Member) error {
	rows := make([][]string, len(members))
	for i, m := range members {
		rows[i] = memberToRow(m)
	}
	return s.writeCSV(membersFile, membersHeader, rows)
}
