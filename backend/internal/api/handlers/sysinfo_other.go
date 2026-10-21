//go:build !darwin && !linux

package handlers

import "errors"

// Fallback for platforms outside darwin/linux (the Docker image is linux,
// development happens on darwin): report zeros rather than failing the build.

func sysTotalMemMB() int { return 0 }

func sysFreeMemMB() int { return 0 }

func procRSSMB() int { return 0 }

func sysLoadAvg() ([3]float64, error) {
	return [3]float64{}, errors.New("loadavg unavailable on this platform")
}
