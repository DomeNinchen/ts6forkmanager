package main

import (
	"net"
	"os/exec"
	"testing"
	"time"
)

// Every RTP packet ffmpeg sends must stay at rtpPacketSize. Uncapped, ffmpeg
// fills video packets up to 1472 bytes, which SRTP and the UDP/IP headers push
// past a 1500-byte MTU, and viewers behind routers that drop IP fragments got
// the audio but never a picture.
func TestFFmpegRTPPacketsStayWithinCap(t *testing.T) {
	if _, err := exec.LookPath(getFfmpegPath()); err != nil {
		t.Skip("ffmpeg not installed")
	}

	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	port := conn.LocalAddr().(*net.UDPAddr).Port

	// A busy 720p test pattern at a high bitrate, so nearly every frame
	// spans several packets and an uncapped packetizer would fill them all.
	args := []string{
		"-loglevel", "error",
		"-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30",
		"-t", "1",
		"-pix_fmt", "yuv420p", "-c:v", "libvpx", "-deadline", "realtime",
		"-b:v", "6000k", "-g", "15",
	}
	args = append(args, rtpOutputArgs(96, 11111111, port)...)
	cmd := exec.Command(getFfmpegPath(), args...)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer cmd.Process.Kill()

	buf := make([]byte, 65536)
	packets, largest := 0, 0
	for {
		conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		n, err := conn.Read(buf)
		if err != nil {
			break
		}
		packets++
		if n > largest {
			largest = n
		}
	}

	if packets == 0 {
		t.Fatal("ffmpeg sent no RTP packets")
	}
	if largest > rtpPacketSize {
		t.Fatalf("largest RTP packet is %d bytes, want at most %d", largest, rtpPacketSize)
	}
	// Proves the cap is what limits the size, not a source too small to fill packets.
	if largest < rtpPacketSize-100 {
		t.Fatalf("largest RTP packet is only %d bytes; the test video no longer fills packets", largest)
	}
}
