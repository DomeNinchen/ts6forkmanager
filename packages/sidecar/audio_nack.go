package main

import (
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/interceptor"
	"github.com/pion/interceptor/pkg/nack"
	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
)

// The TeamSpeak 6 client and Chromium ask for lost sound packets only when the
// offer lists "nack" for audio (registerAudioNack), but leave it out of their
// answer, and the default NACK responder serves only negotiated streams. This
// second responder takes the sound streams the default one leaves alone, so a
// viewer that does negotiate it never gets a packet twice.
func newAudioNackResponder() (*nack.ResponderInterceptorFactory, error) {
	return nack.NewResponderInterceptor(nack.ResponderStreamsFilter(func(info *interceptor.StreamInfo) bool {
		return isAudioStream(info) && !negotiatedNack(info)
	}))
}

// registerAudioNack offers nack for every audio codec registered so far.
func registerAudioNack(m *webrtc.MediaEngine) {
	m.RegisterFeedback(webrtc.RTCPFeedback{Type: "nack"}, webrtc.RTPCodecTypeAudio)
}

func isAudioStream(info *interceptor.StreamInfo) bool {
	return strings.HasPrefix(strings.ToLower(info.MimeType), "audio/")
}

// negotiatedNack is the default responder's own test (pion's streamSupportNack).
func negotiatedNack(info *interceptor.StreamInfo) bool {
	for _, fb := range info.RTCPFeedback {
		if fb.Type == "nack" && fb.Parameter == "" {
			return true
		}
	}
	return false
}

// audioNackDebug is the backend's "Stream Audio Debug" switch (POST /debug).
var audioNackDebug atomic.Bool

const audioNackLogEvery = 10 * time.Second

// audioNackCounter only counts a viewer's requests for sound packets, for the
// debug log; it never changes a packet.
type audioNackCounterFactory struct{ peerID string }

func (f audioNackCounterFactory) NewInterceptor(string) (interceptor.Interceptor, error) {
	c := &audioNackCounter{peerID: f.peerID, done: make(chan struct{})}
	go c.report()
	return c, nil
}

type audioNackCounter struct {
	interceptor.NoOp
	peerID    string
	ssrcs     sync.Map // audio SSRCs of this peer
	requested atomic.Uint64
	done      chan struct{}
	closeOnce sync.Once
}

func (c *audioNackCounter) BindLocalStream(info *interceptor.StreamInfo, writer interceptor.RTPWriter) interceptor.RTPWriter {
	if isAudioStream(info) {
		c.ssrcs.Store(info.SSRC, struct{}{})
	}
	return writer
}

func (c *audioNackCounter) BindRTCPReader(reader interceptor.RTCPReader) interceptor.RTCPReader {
	return interceptor.RTCPReaderFunc(func(b []byte, a interceptor.Attributes) (int, interceptor.Attributes, error) {
		n, a, err := reader.Read(b, a)
		if err != nil || !audioNackDebug.Load() {
			return n, a, err
		}
		if a == nil {
			a = interceptor.Attributes{}
		}
		pkts, perr := a.GetRTCPPackets(b[:n])
		if perr == nil {
			c.requested.Add(audioNacked(pkts, &c.ssrcs))
		}
		return n, a, err
	})
}

// audioNacked counts the packet numbers asked for again on the given SSRCs.
func audioNacked(pkts []rtcp.Packet, ssrcs *sync.Map) uint64 {
	var total uint64
	for _, p := range pkts {
		if nk, ok := p.(*rtcp.TransportLayerNack); ok {
			if _, audio := ssrcs.Load(nk.MediaSSRC); audio {
				for _, pair := range nk.Nacks {
					total += uint64(len(pair.PacketList()))
				}
			}
		}
	}
	return total
}

func (c *audioNackCounter) report() {
	t := time.NewTicker(audioNackLogEvery)
	defer t.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-t.C:
			if n := c.requested.Swap(0); n > 0 && audioNackDebug.Load() {
				log.Printf("[AudioNACK] Peer %s asked for %d sound packet(s) again in the last %s (each is resent while still buffered, about 20 s)", c.peerID, n, audioNackLogEvery)
			}
		}
	}
}

func (c *audioNackCounter) Close() error {
	c.closeOnce.Do(func() { close(c.done) })
	return nil
}
