package main

import (
	"os/exec"
	"testing"
)

// A live source the backend has to re-open is only reported when the running
// ffmpeg ended by itself, never for one we stopped or replaced.
func TestSourceEndedOnlyForCurrentFFmpeg(t *testing.T) {
	s := &Sidecar{peers: map[string]*Peer{}}
	current := &exec.Cmd{}
	s.ffmpeg = current

	// Positive: the running ffmpeg exits by itself
	s.onFFmpegExit(current)
	if !s.sourceEnded || s.ffmpeg != nil {
		t.Fatalf("own exit: sourceEnded=%v ffmpeg=%v, want true/nil", s.sourceEnded, s.ffmpeg)
	}
	if got := s.GetStats()["sourceEnded"]; got != true {
		t.Fatalf("stats sourceEnded = %v, want true", got)
	}

	// A new source clears the flag (StartFFmpeg stops the old one first)
	s.ffmpegLock.Lock()
	s.StopFFmpegLocked()
	s.ffmpegLock.Unlock()
	if s.sourceEnded {
		t.Fatal("sourceEnded survived a stop/new source")
	}

	// Negative: a replaced ffmpeg's late exit must not mark the new one as ended
	replaced := &exec.Cmd{}
	s.ffmpeg = &exec.Cmd{}
	s.onFFmpegExit(replaced)
	if s.sourceEnded || s.ffmpeg == nil {
		t.Fatalf("replaced exit: sourceEnded=%v ffmpeg=%v, want false/non-nil", s.sourceEnded, s.ffmpeg)
	}
}
