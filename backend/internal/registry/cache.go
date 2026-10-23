package registry

import (
	"sort"
	"sync"
	"time"
)

// DigestCacheTTL matches Node's config.cache.digestCacheTTL (24 hours).
const DigestCacheTTL = 24 * time.Hour

// Cache size bounds. Entries used to be removed only when their exact key was
// read back after expiry, so a key that is never looked up again is pinned
// forever and the map grows with every image the fleet has ever run.
const (
	// sweepThreshold is the point at which a write also drops expired entries.
	sweepThreshold = 1024
	// maxEntries is the hard cap enforced after a sweep.
	maxEntries = 4096
)

type cacheEntry struct {
	result    *DigestResult
	expiresAt time.Time
}

// DigestCache is the shared TTL cache used by every provider (Node shares a
// single module-level digestCache across providers).
type DigestCache struct {
	mu    sync.Mutex
	ttl   time.Duration
	items map[string]cacheEntry
}

func NewDigestCache(ttl time.Duration) *DigestCache {
	if ttl <= 0 {
		ttl = DigestCacheTTL
	}
	return &DigestCache{ttl: ttl, items: make(map[string]cacheEntry)}
}

func (c *DigestCache) Get(key string) (*DigestResult, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.items[key]
	if !ok {
		return nil, false
	}
	if time.Now().After(entry.expiresAt) {
		delete(c.items, key)
		return nil, false
	}
	return entry.result, true
}

func (c *DigestCache) Set(key string, result *DigestResult) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items[key] = cacheEntry{result: result, expiresAt: time.Now().Add(c.ttl)}
	if len(c.items) >= sweepThreshold {
		c.sweepLocked(time.Now())
	}
}

// sweepLocked drops expired entries, then the entries that expire soonest if
// the map is still over the cap. Those are the oldest writes, so they are the
// closest to useless. Caller must hold c.mu.
func (c *DigestCache) sweepLocked(now time.Time) {
	for k, e := range c.items {
		if now.After(e.expiresAt) {
			delete(c.items, k)
		}
	}
	if len(c.items) <= maxEntries {
		return
	}
	expiry := make([]time.Time, 0, len(c.items))
	for _, e := range c.items {
		expiry = append(expiry, e.expiresAt)
	}
	sort.Slice(expiry, func(i, j int) bool { return expiry[i].Before(expiry[j]) })
	cutoff := expiry[len(expiry)-maxEntries]
	for k, e := range c.items {
		if !e.expiresAt.After(cutoff) {
			delete(c.items, k)
		}
	}
}

// Size reports the live entry count for debug introspection.
func (c *DigestCache) Size() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.items)
}

func (c *DigestCache) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.items, key)
}

func (c *DigestCache) Clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items = make(map[string]cacheEntry)
}
