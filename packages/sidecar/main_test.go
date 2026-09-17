package main

import (
	"testing"

	"github.com/pion/rtp"
)

func newTestRewriter() rtpRewriter {
	return rtpRewriter{advance: 3000, maxJump: 900_000}
}

// feed pushes count packets through the rewriter, stepping one 30fps frame on
// a 90kHz clock each time, and records what the receivers would see.
func feed(r *rtpRewriter, sent *[]rtp.Packet, count int, startSeq uint16, startTS uint32) {
	seq, ts := startSeq, startTS
	for i := 0; i < count; i++ {
		pkt := &rtp.Packet{Header: rtp.Header{SequenceNumber: seq, Timestamp: ts}}
		r.apply(pkt)
		*sent = append(*sent, *pkt)
		seq++
		ts += 3000
	}
}

func assertContinuous(t *testing.T, sent []rtp.Packet) {
	t.Helper()
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

// A source switch restarts ffmpeg, which picks a fresh random sequence number
// and timestamp base. Receivers already attached to the track must not notice:
// if the numbering jumps, their jitter buffer discards everything and the
// player goes black while the connection stays up.
func TestRewriterKeepsNumberingContinuousAcrossSourceSwitch(t *testing.T) {
	r := newTestRewriter()

	var sent []rtp.Packet
	feed(&r, &sent, 3, 5000, 1_000_000)
	// ffmpeg restarts with bases that deliberately run backwards
	r.markNewSegment()
	feed(&r, &sent, 3, 9, 42)

	if len(sent) != 6 {
		t.Fatalf("expected 6 packets, got %d", len(sent))
	}
	assertContinuous(t, sent)
}

// Killing ffmpeg does not stop its last packets from arriving - they sit in the
// socket buffer and are read after the queues have been drained. Anchoring the
// new offset to whichever packet arrives first therefore anchors it to one of
// those stragglers, and the genuinely new source lands at the wrong offset.
// That is the bug the first version of this rewriter still had in production.
func TestRewriterIgnoresStragglersFromTheOldSource(t *testing.T) {
	r := newTestRewriter()

	var sent []rtp.Packet
	feed(&r, &sent, 3, 5000, 1_000_000)
	r.markNewSegment()
	// Two late packets from the source that was just killed, continuing its
	// timeline where it left off.
	feed(&r, &sent, 2, 5003, 1_009_000)
	// Only now does the new source start, far away on its own clock.
	feed(&r, &sent, 3, 40_000, 700_000_000)

	if len(sent) != 8 {
		t.Fatalf("expected 8 packets, got %d", len(sent))
	}
	assertContinuous(t, sent)

	// The stragglers belong to the old timeline and must not have been
	// shifted: they are still one frame apart from the packet before them.
	if delta := sent[3].Timestamp - sent[2].Timestamp; delta != 3000 {
		t.Errorf("first straggler moved by %d, want the original 3000", delta)
	}
}

// Without a switch the rewriter must not disturb the timeline: spacing between
// packets has to survive untouched, or playback speed changes.
func TestRewriterPreservesSpacingWithinOneSource(t *testing.T) {
	r := newTestRewriter()

	first := &rtp.Packet{Header: rtp.Header{SequenceNumber: 100, Timestamp: 7_000}}
	second := &rtp.Packet{Header: rtp.Header{SequenceNumber: 101, Timestamp: 10_000}}
	r.apply(first)
	r.apply(second)

	if delta := second.Timestamp - first.Timestamp; delta != 3_000 {
		t.Errorf("spacing changed to %d, want the original 3000", delta)
	}
}
