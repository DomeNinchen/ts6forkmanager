package main

import "testing"

// Deliberately failing: proves the CI sidecar job turns red. Never merged.
func TestCIRedCheck(t *testing.T) {
	t.Fatal("deliberate failure to check that CI runs the Go tests")
}
