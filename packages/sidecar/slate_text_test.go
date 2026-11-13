package main

import "testing"

func TestCleanSlateText(t *testing.T) {
	if got := cleanSlateText("Twitch ad break - the stream continues after it"); got != "Twitch ad break - the stream continues after it" {
		t.Fatalf("plain text changed: %q", got)
	}
	// Quote, colon, comma and backslash would break out of drawtext's text='...'
	if got := cleanSlateText(`a':b,c\d;e`); got != "abcde" {
		t.Fatalf("not stripped: %q", got)
	}
}
