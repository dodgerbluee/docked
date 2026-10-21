//go:build linux

package handlers

import (
	"errors"
	"os"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

// sysTotalMemMB / sysFreeMemMB / procRSSMB back the debug health endpoint.
// linux: /proc/meminfo for system memory, getrusage (kilobytes) for RSS.

func meminfoKB() (totalKB, availKB int) {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		v, _ := strconv.Atoi(fields[1])
		switch strings.TrimSuffix(fields[0], ":") {
		case "MemTotal":
			totalKB = v
		case "MemAvailable":
			availKB = v
		}
	}
	return totalKB, availKB
}

func sysTotalMemMB() int {
	totalKB, _ := meminfoKB()
	return totalKB / 1024
}

func sysFreeMemMB() int {
	_, availKB := meminfoKB()
	return availKB / 1024
}

func procRSSMB() int {
	var ru unix.Rusage
	if err := unix.Getrusage(unix.RUSAGE_SELF, &ru); err != nil {
		return 0
	}
	return int(ru.Maxrss / 1024) // kilobytes on linux
}

// sysLoadAvg returns the 1/5/15-minute load averages (Node's os.loadavg()).
// x/sys/unix has no Getloadavg on linux; read /proc/loadavg instead.
func sysLoadAvg() ([3]float64, error) {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return [3]float64{}, err
	}
	fields := strings.Fields(string(data))
	if len(fields) < 3 {
		return [3]float64{}, errors.New("short /proc/loadavg")
	}
	var out [3]float64
	for i := 0; i < 3; i++ {
		v, err := strconv.ParseFloat(fields[i], 64)
		if err != nil {
			return [3]float64{}, err
		}
		out[i] = v
	}
	return out, nil
}
