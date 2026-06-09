package main

import "testing"

func TestAllowLocalhostOrigin(t *testing.T) {
	allowed := []string{
		"http://localhost:5173",  // default Vite port
		"http://localhost:5174",  // fallback when 5173 is taken — the bug
		"http://localhost:5175",  // any other fallback port
		"http://127.0.0.1:5173",  // loopback IPv4
		"https://localhost:5173", // https dev server
		"http://[::1]:5173",      // loopback IPv6
		"http://localhost",       // no explicit port
	}
	for _, origin := range allowed {
		if !allowLocalhostOrigin(origin) {
			t.Errorf("expected origin %q to be allowed", origin)
		}
	}

	denied := []string{
		"http://evil.com",
		"https://example.com:5173",
		"http://localhost.evil.com", // suffix attack
		"http://notlocalhost:5173",
		"",
	}
	for _, origin := range denied {
		if allowLocalhostOrigin(origin) {
			t.Errorf("expected origin %q to be denied", origin)
		}
	}
}
