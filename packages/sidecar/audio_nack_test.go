package main

import (
	"sync"
	"testing"

	"github.com/pion/rtcp"
)

// The debug count takes only the sound's SSRCs and every packet a NACK pair names.
func TestAudioNackedCountsOnlySoundPackets(t *testing.T) {
	var ssrcs sync.Map
	ssrcs.Store(uint32(7), struct{}{})
	pkts := []rtcp.Packet{
		&rtcp.TransportLayerNack{MediaSSRC: 7, Nacks: []rtcp.NackPair{{PacketID: 10, LostPackets: 0b101}}}, // 10, 11, 13
		&rtcp.TransportLayerNack{MediaSSRC: 8, Nacks: []rtcp.NackPair{{PacketID: 20}}},                    // video
		&rtcp.PictureLossIndication{MediaSSRC: 7},
	}
	if n := audioNacked(pkts, &ssrcs); n != 3 {
		t.Fatalf("got %d, want 3", n)
	}
}
