package main

import (
	"testing"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

// A viewer that asks for a lost video packet again (RTCP NACK) must get it a
// second time. Before the sidecar read its senders' RTCP, every such request
// was ignored and each lost packet left the picture frozen until the next keyframe.
func TestNackedVideoPacketIsSentAgain(t *testing.T) {
	t.Setenv("STUN_SERVERS", "stun:127.0.0.1:1")
	s := NewSidecar()
	offer, err := s.CreatePeer("nack-test")
	if err != nil {
		t.Fatal(err)
	}
	defer s.ClosePeer("nack-test")

	// A bare receiver: default codecs, but no interceptors, so it never sends NACKs by itself.
	// Here the packet was not really lost, so the resend is a duplicate that SRTP replay
	// protection would drop; a real viewer never had the original and accepts it.
	m := &webrtc.MediaEngine{}
	if err := m.RegisterDefaultCodecs(); err != nil {
		t.Fatal(err)
	}
	se := webrtc.SettingEngine{}
	se.DisableSRTPReplayProtection(true)
	rx, err := webrtc.NewAPI(webrtc.WithMediaEngine(m), webrtc.WithSettingEngine(se)).NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer rx.Close()

	const nacked = uint16(1003)
	seen := make(chan uint16, 256)
	videoSSRC := make(chan uint32, 1)
	rx.OnTrack(func(track *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		if track.Kind() != webrtc.RTPCodecTypeVideo {
			return
		}
		videoSSRC <- uint32(track.SSRC())
		for {
			pkt, _, err := track.ReadRTP()
			if err != nil {
				return
			}
			seen <- pkt.SequenceNumber
		}
	})

	if err := rx.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: offer}); err != nil {
		t.Fatal(err)
	}
	answer, err := rx.CreateAnswer(nil)
	if err != nil {
		t.Fatal(err)
	}
	gathered := webrtc.GatheringCompletePromise(rx)
	if err := rx.SetLocalDescription(answer); err != nil {
		t.Fatal(err)
	}
	<-gathered
	if ignored, err := s.SetAnswer("nack-test", rx.LocalDescription().SDP); err != nil || ignored != "" {
		t.Fatalf("answer not applied: err=%v ignored=%q", err, ignored)
	}

	s.peersLock.RLock()
	peer := s.peers["nack-test"]
	s.peersLock.RUnlock()
	deadline := time.Now().Add(10 * time.Second)
	for rx.ICEConnectionState() != webrtc.ICEConnectionStateConnected || peer.PC.ConnectionState() != webrtc.PeerConnectionStateConnected {
		if time.Now().After(deadline) {
			t.Fatalf("not connected: ice=%s", rx.ICEConnectionState())
		}
		time.Sleep(50 * time.Millisecond)
	}

	for i := uint16(0); i < 10; i++ {
		pkt := &rtp.Packet{
			Header:  rtp.Header{Version: 2, PayloadType: 96, SequenceNumber: 1000 + i, Timestamp: 90000 + uint32(i)*3000},
			Payload: []byte{0x10, 0x00, 0x00, 0x00, byte(i)},
		}
		if err := peer.VideoTrack.WriteRTP(pkt); err != nil {
			t.Fatal(err)
		}
	}

	var ssrc uint32
	select {
	case ssrc = <-videoSSRC:
	case <-time.After(5 * time.Second):
		t.Fatal("no video track arrived")
	}
	count := map[uint16]int{}
	collect := func(d time.Duration) {
		end := time.After(d)
		for {
			select {
			case seq := <-seen:
				count[seq]++
			case <-end:
				return
			}
		}
	}
	collect(500 * time.Millisecond)
	if count[nacked] != 1 {
		t.Fatalf("packet %d should have arrived once before the NACK, got %d (%v)", nacked, count[nacked], count)
	}

	if err := rx.WriteRTCP([]rtcp.Packet{&rtcp.TransportLayerNack{
		SenderSSRC: 1, MediaSSRC: ssrc, Nacks: []rtcp.NackPair{{PacketID: nacked}},
	}}); err != nil {
		t.Fatal(err)
	}
	collect(2 * time.Second)
	if count[nacked] < 2 {
		t.Fatalf("packet %d was not sent again after the NACK (seen %d times)", nacked, count[nacked])
	}
}
