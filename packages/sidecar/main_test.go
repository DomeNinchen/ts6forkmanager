package main

import (
	"testing"

	"github.com/pion/rtp"
)

// A source switch restarts ffmpeg, which picks a fresh random sequence number
// and timestamp base. Receivers already attached to the track must not notice:
// if the numbering jumps, their jitter buffer discards everything and the
// player goes black while the connection stays up.
func TestRewriterKeepsNumberingContinuousAcrossSourceSwitch(t *testing.T) {
	r := rtpRewriter{advance: 3000}

	var sent []rtp.Packet
	feed := func(count int, startSeq uint16, startTS uint32) {
		seq, ts := startSeq, startTS
		for i := 0; i < count; i++ {
			pkt := &rtp.Packet{Header: rtp.Header{SequenceNumber: seq, Timestamp: ts}}
			r.apply(pkt)
			sent = append(sent, *pkt)
			seq++
			ts += 3000 // one frame at 30fps on a 90kHz clock
		}
	}

	feed(3, 5000, 1_000_000)
	// ffmpeg restarts with bases that deliberately run backwards
	r.markNewSegment()
	feed(3, 9, 42)

	if len(sent) != 6 {
		t.Fatalf("expected 6 packets, got %d", len(sent))
	}

	for i := 1; i < len(sent); i++ {
		if got, want := sent[i].SequenceNumber, sent[i-1].SequenceNumber+1; got != want {
			t.Errorf("packet %d: sequence number %d, want %d (a gap stalls the receiver)", i, got, want)
		}
		// uint32 arithmetic: a backwards step shows up as a huge delta
		if delta := sent[i].Timestamp - sent[i-1].Timestamp; delta == 0 || delta > 90_000 {
			t.Errorf("packet %d: timestamp moved by %d, want a small forward step", i, delta)
		}
	}
}

// Without a switch the rewriter must not disturb the timeline: spacing between
// packets has to survive untouched, or playback speed changes.
func TestRewriterPreservesSpacingWithinOneSource(t *testing.T) {
	r := rtpRewriter{advance: 3000}

	first := &rtp.Packet{Header: rtp.Header{SequenceNumber: 100, Timestamp: 7_000}}
	second := &rtp.Packet{Header: rtp.Header{SequenceNumber: 101, Timestamp: 10_000}}
	r.apply(first)
	r.apply(second)

	if delta := second.Timestamp - first.Timestamp; delta != 3_000 {
		t.Errorf("spacing changed to %d, want the original 3000", delta)
	}
}
