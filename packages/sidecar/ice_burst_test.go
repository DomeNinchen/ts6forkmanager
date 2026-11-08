package main

import (
	"fmt"
	"net"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

// natRelay stands in for the viewer's home router: the viewer only knows the
// sidecar as viewerSide, the sidecar only knows the viewer as sidecarSide, and
// packets from the sidecar are dropped until the viewer has sent one itself.
type natRelay struct {
	viewerSide, sidecarSide *net.UDPConn
	sidecar                 *net.UDPAddr
	viewer                  atomic.Pointer[net.UDPAddr]
	dropped                 atomic.Int32
}

func newNATRelay(t *testing.T, ip string, sidecar *net.UDPAddr) *natRelay {
	t.Helper()
	listen := func() *net.UDPConn {
		c, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.ParseIP(ip)})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { c.Close() })
		return c
	}
	r := &natRelay{viewerSide: listen(), sidecarSide: listen(), sidecar: sidecar}
	go func() {
		buf := make([]byte, 1500)
		for {
			n, from, err := r.viewerSide.ReadFromUDP(buf)
			if err != nil {
				return
			}
			r.viewer.Store(from) // the viewer's packet opens the "NAT"
			r.sidecarSide.WriteToUDP(buf[:n], r.sidecar)
		}
	}()
	go func() {
		buf := make([]byte, 1500)
		for {
			n, _, err := r.sidecarSide.ReadFromUDP(buf)
			if err != nil {
				return
			}
			if v := r.viewer.Load(); v != nil {
				r.viewerSide.WriteToUDP(buf[:n], v)
			} else {
				r.dropped.Add(1)
			}
		}
	}()
	return r
}

var hostCandidate = regexp.MustCompile(`a=candidate:\S+ 1 udp \d+ (\d+\.\d+\.\d+\.\d+) (\d+) typ host`)

func withoutCandidates(sdp string) string {
	var keep []string
	for _, l := range strings.Split(sdp, "\r\n") {
		if !strings.HasPrefix(l, "a=candidate:") && l != "a=end-of-candidates" {
			keep = append(keep, l)
		}
	}
	return strings.Join(keep, "\r\n")
}

// connectsBehindNAT plays the TeamSpeak 6 client from issue #375: its public
// candidate, then 7 TCP candidates in one burst, and its own checks only start
// after the sidecar's first checks were already dropped by the router.
func connectsBehindNAT(t *testing.T, within time.Duration) bool {
	t.Setenv("STUN_SERVERS", "stun:127.0.0.1:1")
	s := NewSidecar()
	offer, err := s.CreatePeer("burst-test")
	if err != nil {
		t.Fatal(err)
	}
	defer s.ClosePeer("burst-test")
	m := hostCandidate.FindStringSubmatch(offer)
	if m == nil {
		t.Fatalf("no IPv4 UDP host candidate in the offer:\n%s", offer)
	}
	var port int
	fmt.Sscan(m[2], &port)
	relay := newNATRelay(t, m[1], &net.UDPAddr{IP: net.ParseIP(m[1]), Port: port})

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
	if ignored, err := s.SetAnswer("burst-test", withoutCandidates(viewer.LocalDescription().SDP)); err != nil || ignored != "" {
		t.Fatalf("answer not applied: err=%v ignored=%q", err, ignored)
	}

	public := relay.sidecarSide.LocalAddr().(*net.UDPAddr)
	if err := s.AddICECandidate("burst-test", fmt.Sprintf("candidate:1 1 udp 1694498815 %s %d typ srflx raddr 0.0.0.0 rport 0", public.IP, public.Port), "0", 0); err != nil {
		t.Fatal(err)
	}
	s.peersLock.RLock()
	peer := s.peers["burst-test"]
	s.peersLock.RUnlock()
	// pion only starts checking once its own gathering is done (~5 s with no STUN answer)
	for start := time.Now(); peer.PC.ICEConnectionState() != webrtc.ICEConnectionStateChecking; time.Sleep(10 * time.Millisecond) {
		if time.Since(start) > 15*time.Second {
			t.Fatal("sidecar never started checking")
		}
	}
	// Each trickled candidate runs one more check round on every pair, even a TCP
	// candidate that pairs with nothing.
	for i := 0; i < 7; i++ {
		c := fmt.Sprintf("candidate:%d 1 tcp 1518280447 192.0.2.%d %d typ host tcptype passive", 10+i, 10+i, 58234+i)
		if err := s.AddICECandidate("burst-test", c, "0", 0); err != nil {
			t.Fatal(err)
		}
		time.Sleep(5 * time.Millisecond)
	}
	time.Sleep(100 * time.Millisecond) // the client's first packet came ~0.1 s after the burst
	t.Logf("sidecar checks dropped before the viewer's first packet: %d", relay.dropped.Load())
	front := relay.viewerSide.LocalAddr().(*net.UDPAddr)
	mid := "0"
	var mline uint16
	if err := viewer.AddICECandidate(webrtc.ICECandidateInit{
		Candidate:     fmt.Sprintf("candidate:1 1 udp 2130706431 %s %d typ host", front.IP, front.Port),
		SDPMid:        &mid,
		SDPMLineIndex: &mline,
	}); err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		if peer.PC.ICEConnectionState() == webrtc.ICEConnectionStateConnected {
			return true
		}
		time.Sleep(50 * time.Millisecond)
	}
	return false
}

func TestViewerBehindNATConnectsAfterCandidateBurst(t *testing.T) {
	if !connectsBehindNAT(t, 8*time.Second) {
		t.Fatal("sidecar never connected to a viewer behind a NAT after a burst of trickled candidates")
	}
}

// Positive control: with pion's default limit the same viewer must stay stuck,
// otherwise the test above does not reproduce the bug.
func TestCandidateBurstStillBreaksWithPionDefaultLimit(t *testing.T) {
	old := iceMaxBindingRequests
	iceMaxBindingRequests = 7
	defer func() { iceMaxBindingRequests = old }()
	if connectsBehindNAT(t, 8*time.Second) {
		t.Fatal("connected with the default limit of 7: the test no longer reproduces issue #375")
	}
}
