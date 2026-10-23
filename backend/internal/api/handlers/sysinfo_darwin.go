//go:build darwin

package handlers

import (
	"encoding/binary"
	"errors"

	"golang.org/x/sys/unix"
)

// sysTotalMemMB / sysFreeMemMB / procRSSMB back the debug health endpoint.
// darwin: sysctl for system memory, getrusage (bytes) for RSS.

func sysTotalMemMB() int {
	n, err := unix.SysctlUint64("hw.memsize")
	if err != nil {
		return 0
	}
	return int(n / 1024 / 1024)
}

func sysFreeMemMB() int {
	// vm.page_free_count is a 4-byte int, so SysctlUint64 (8 bytes) fails;
	// read the raw bytes instead.
	b, err := unix.SysctlRaw("vm.page_free_count")
	if err != nil || len(b) < 4 {
		return 0
	}
	free := uint64(binary.LittleEndian.Uint32(b[0:4]))
	return int(free * uint64(unix.Getpagesize()) / 1024 / 1024)
}

func procRSSMB() int {
	var ru unix.Rusage
	if err := unix.Getrusage(unix.RUSAGE_SELF, &ru); err != nil {
		return 0
	}
	return int(ru.Maxrss / 1024 / 1024) // bytes on darwin
}

// sysLoadAvg returns the 1/5/15-minute load averages (Node's os.loadavg()).
// darwin's x/sys has no Getloadavg; read the vm.loadavg sysctl instead.
// The kernel hands back a 24-byte struct (aven[4] + fscale at offset 16,
// observed on arm64); older/other layouts put fscale at offset 12. aven
// values are fixed-point with fscale = 2048.
func sysLoadAvg() ([3]float64, error) {
	b, err := unix.SysctlRaw("vm.loadavg")
	if err != nil {
		return [3]float64{}, err
	}
	fscaleOff := -1
	if len(b) >= 20 {
		fscaleOff = 16
	} else if len(b) >= 16 {
		fscaleOff = 12
	} else {
		return [3]float64{}, errors.New("short vm.loadavg response")
	}
	fscale := float64(int32(binary.LittleEndian.Uint32(b[fscaleOff : fscaleOff+4])))
	if fscale == 0 {
		return [3]float64{}, errors.New("zero vm.loadavg fscale")
	}
	return [3]float64{
		float64(int32(binary.LittleEndian.Uint32(b[0:4]))) / fscale,
		float64(int32(binary.LittleEndian.Uint32(b[4:8]))) / fscale,
		float64(int32(binary.LittleEndian.Uint32(b[8:12]))) / fscale,
	}, nil
}
