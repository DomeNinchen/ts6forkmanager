package main

import (
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

var iceUfrag = regexp.MustCompile(`a=ice-ufrag:(\S+)`)

// viewerRecoversAfterRestart plays issue #467: the first path never works (no
// candidates get through), then the viewer restarts ICE with its own offer and
// a new ufrag, the way the TS6 client does ~22 s after a failed path. With
// answered=false the offer goes nowhere, as before 2.6.0, and only the new
// candidates (tagged with the new ufrag, like the TS6 client's) reach the sidecar.
func viewerRecoversAfterRestart(t *testing.T, answered bool) bool {
	t.Setenv("STUN_SERVERS", "stun:127.0.0.1:1")
	s := NewSidecar()
	offer, err := s.CreatePeer("restart-test")
	if err != nil {
		t.Fatal(err)
	}
	defer s.ClosePeer("restart-test")

	viewer, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer viewer.Close()
	if err := viewer.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: withoutCandidates(offer)}); err != nil {
		t.Fatal(err)
	}
	answer, err := viewer.CreateAnswer(nil)
	if err != nil {
		t.Fatal(err)
	}
	gathered := webrtc.GatheringCompletePromise(viewer)
	if err := viewer.SetLocalDescription(answer); err != nil {
		t.Fatal(err)
	}
	<-gathered
	if ignored, err := s.SetAnswer("restart-test", withoutCandidates(viewer.LocalDescription().SDP)); err != nil || ignored != "" {
		t.Fatalf("answer not applied: err=%v ignored=%q", err, ignored)
	}
	s.peersLock.RLock()
	peer := s.peers["restart-test"]
	s.peersLock.RUnlock()
	time.Sleep(2 * time.Second)
	if peer.PC.ICEConnectionState() == webrtc.ICEConnectionStateConnected {
		t.Fatal("connected without any candidates: the first path is not broken")
	}

	restart, err := viewer.CreateOffer(&webrtc.OfferOptions{ICERestart: true})
	if err != nil {
		t.Fatal(err)
	}
	gathered = webrtc.GatheringCompletePromise(viewer)
	if err := viewer.SetLocalDescription(restart); err != nil {
		t.Fatal(err)
	}
	<-gathered
	restartSDP := viewer.LocalDescription().SDP
	if answered {
		reply, err := s.AnswerOffer("restart-test", restartSDP)
		if err != nil {
			t.Fatal(err)
		}
		if iceUfrag.FindString(reply) == iceUfrag.FindString(offer) {
			t.Fatal("the sidecar's answer kept its old ufrag")
		}
		if err := viewer.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: reply}); err != nil {
			t.Fatal(err)
		}
	} else {
		ufrag := iceUfrag.FindStringSubmatch(restartSDP)[1]
		for _, l := range strings.Split(restartSDP, "\r\n") {
			if strings.HasPrefix(l, "a=candidate:") {
				_ = s.AddICECandidate("restart-test", strings.TrimPrefix(l, "a=")+" ufrag "+ufrag, "0", 0)
			}
		}
	}

	for deadline := time.Now().Add(8 * time.Second); time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
		if peer.PC.ICEConnectionState() == webrtc.ICEConnectionStateConnected {
			return true
		}
	}
	return false
}

func TestViewerICERestartIsAnswered(t *testing.T) {
	if !viewerRecoversAfterRestart(t, true) {
		t.Fatal("viewer never connected after its ICE restart offer was answered")
	}
}

// Positive control: the same viewer without an answer to its offer must stay
// stuck, otherwise the test above proves nothing.
func TestUnansweredICERestartStaysStuck(t *testing.T) {
	if viewerRecoversAfterRestart(t, false) {
		t.Fatal("connected without answering the restart offer: the test no longer reproduces issue #467")
	}
}
