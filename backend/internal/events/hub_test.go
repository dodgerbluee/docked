package events

import (
	"testing"

	"github.com/dockedapp/backend/graph/model"
)

// A subscriber whose buffer is full must have its drops counted (and
// logged), not silently swallowed: delivery stays non-blocking but the
// failure becomes observable.
func TestHubCountsDroppedEvents(t *testing.T) {
	h := NewHub()
	ch, unsub := h.SubscribeContainersUpdated(1)
	defer unsub()

	// Buffer capacity is 4: publish past it without draining.
	for i := 0; i < 6; i++ {
		h.PublishContainersUpdated(1, model.ContainersUpdatedEvent{ContainerCount: i})
	}
	if got := len(ch); got != 4 {
		t.Fatalf("buffered events = %d, want 4", got)
	}
	if got := h.Dropped(); got != 2 {
		t.Fatalf("Dropped() = %d, want 2", got)
	}

	// Broadcast audience reaches the same subscriber and drops are shared.
	h.PublishContainersUpdated(BroadcastUserID, model.ContainersUpdatedEvent{ContainerCount: 9})
	if got := h.Dropped(); got != 3 {
		t.Fatalf("Dropped() = %d, want 3", got)
	}
}
