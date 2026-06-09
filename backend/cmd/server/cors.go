package main

import "net/url"

// allowLocalhostOrigin reports whether a CORS Origin header belongs to a local
// development server. The Vite dev server binds to 5173 by default but falls
// back to 5174, 5175, … whenever the previous port is taken, so pinning a
// single port in the allowlist breaks every mutating request (POST/PUT/DELETE)
// the moment the port shifts. Matching any localhost/loopback host on any port
// keeps the dev workflow working regardless of which port Vite picks.
//
// In production the frontend is served same-origin by this same binary, so no
// cross-origin request is made and this function is never consulted.
func allowLocalhostOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	switch u.Hostname() {
	case "localhost", "127.0.0.1", "::1":
		return true
	default:
		return false
	}
}
