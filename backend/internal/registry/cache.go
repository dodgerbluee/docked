package registry

import (
	"sync"
	"time"
)

// DigestCacheTTL matches Node's config.cache.digestCacheTTL (24 hours).
const DigestCacheTTL = 24 * time.Hour

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
