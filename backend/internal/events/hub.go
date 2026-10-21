// Package events provides an in-process pub/sub hub that fans domain
// events out to GraphQL subscription subscribers. Events can originate
// from Go resolvers directly or from the Node process via the
// /internal/events HTTP bridge.
package events

import (
	"log/slog"
	"sync"
	"sync/atomic"

	"github.com/dockedapp/backend/graph/model"
)

// BroadcastUserID is the sentinel audience meaning "deliver to every
// subscriber of this topic" (e.g. container syncs affect all users).
const BroadcastUserID int64 = 0

type topic int

const (
	topicContainersUpdated topic = iota
	topicUpgradeProgress
	topicBatchJob
	topicIntentExecution
	topicRunnerStatus
	topicOperation
)

type subscriber struct {
	userID int64
	topic  topic
	ch     any
}

// Hub fans out typed domain events to matching (user, topic) subscribers.
// Sends are non-blocking: a slow consumer drops events rather than
// stalling the publisher (clients also refetch on (re)load).
type Hub struct {
	mu      sync.Mutex
	next    int
	subs    map[int]*subscriber
	dropped atomic.Uint64
}

func NewHub() *Hub {
	return &Hub{subs: map[int]*subscriber{}}
}

// Dropped returns the total number of events dropped because a subscriber's
// buffer was full (since process start).
func (h *Hub) Dropped() uint64 { return h.dropped.Load() }

// noteDrop records a dropped event. Non-blocking delivery is deliberate (a
// slow consumer must never stall a publisher), but the drop must not be
// invisible: it is counted and logged with sampling — the first drop and
// every 100th — so a permanently wedged subscriber is loud enough to
// diagnose without being able to spam the log.
func (h *Hub) noteDrop(t topic) {
	n := h.dropped.Add(1)
	if n == 1 || n%100 == 0 {
		slog.Warn("event hub: subscriber buffer full, event dropped",
			"topic", topicName(t), "totalDropped", n)
	}
}

func topicName(t topic) string {
	switch t {
	case topicContainersUpdated:
		return "containersUpdated"
	case topicUpgradeProgress:
		return "upgradeProgress"
	case topicBatchJob:
		return "batchJob"
	case topicIntentExecution:
		return "intentExecution"
	case topicRunnerStatus:
		return "runnerStatus"
	case topicOperation:
		return "operation"
	}
	return "unknown"
}

func (h *Hub) add(userID int64, t topic, ch any) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	id := h.next
	h.next++
	h.subs[id] = &subscriber{userID: userID, topic: t, ch: ch}
	return id
}

func (h *Hub) remove(id int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.subs, id)
}

// deliver sends ev to every subscriber of t whose audience matches:
// scoped events go only to their owner; BroadcastUserID reaches everyone.
// send performs the typed non-blocking channel push for the event type.
func (h *Hub) deliver(t topic, userID int64, send func(s *subscriber)) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, s := range h.subs {
		if s.topic != t {
			continue
		}
		if userID != BroadcastUserID && s.userID != userID {
			continue
		}
		send(s)
	}
}

// --- typed subscribe/publish pairs ---------------------------------------

func (h *Hub) SubscribeContainersUpdated(userID int64) (<-chan model.ContainersUpdatedEvent, func()) {
	ch := make(chan model.ContainersUpdatedEvent, 4)
	id := h.add(userID, topicContainersUpdated, ch)
	return ch, func() { h.remove(id) }
}

func (h *Hub) PublishContainersUpdated(userID int64, ev model.ContainersUpdatedEvent) {
	h.deliver(topicContainersUpdated, userID, func(s *subscriber) {
		c := s.ch.(chan model.ContainersUpdatedEvent)
		select {
		case c <- ev:
		default:
			h.noteDrop(topicContainersUpdated)
		}
	})
}

func (h *Hub) SubscribeUpgradeProgress(userID int64) (<-chan model.UpgradeProgressEvent, func()) {
	ch := make(chan model.UpgradeProgressEvent, 8)
	id := h.add(userID, topicUpgradeProgress, ch)
	return ch, func() { h.remove(id) }
}

func (h *Hub) PublishUpgradeProgress(userID int64, ev model.UpgradeProgressEvent) {
	h.deliver(topicUpgradeProgress, userID, func(s *subscriber) {
		c := s.ch.(chan model.UpgradeProgressEvent)
		select {
		case c <- ev:
		default:
			h.noteDrop(topicUpgradeProgress)
		}
	})
}

func (h *Hub) SubscribeBatchJob(userID int64) (<-chan model.BatchRun, func()) {
	ch := make(chan model.BatchRun, 8)
	id := h.add(userID, topicBatchJob, ch)
	return ch, func() { h.remove(id) }
}

func (h *Hub) PublishBatchJob(userID int64, ev model.BatchRun) {
	h.deliver(topicBatchJob, userID, func(s *subscriber) {
		c := s.ch.(chan model.BatchRun)
		select {
		case c <- ev:
		default:
			h.noteDrop(topicBatchJob)
		}
	})
}

func (h *Hub) SubscribeIntentExecution(userID int64) (<-chan model.IntentExecution, func()) {
	ch := make(chan model.IntentExecution, 8)
	id := h.add(userID, topicIntentExecution, ch)
	return ch, func() { h.remove(id) }
}

func (h *Hub) PublishIntentExecution(userID int64, ev model.IntentExecution) {
	h.deliver(topicIntentExecution, userID, func(s *subscriber) {
		c := s.ch.(chan model.IntentExecution)
		select {
		case c <- ev:
		default:
			h.noteDrop(topicIntentExecution)
		}
	})
}

func (h *Hub) SubscribeRunnerStatus(userID int64) (<-chan model.RunnerStatusEvent, func()) {
	ch := make(chan model.RunnerStatusEvent, 8)
	id := h.add(userID, topicRunnerStatus, ch)
	return ch, func() { h.remove(id) }
}

func (h *Hub) PublishRunnerStatus(userID int64, ev model.RunnerStatusEvent) {
	h.deliver(topicRunnerStatus, userID, func(s *subscriber) {
		c := s.ch.(chan model.RunnerStatusEvent)
		select {
		case c <- ev:
		default:
			h.noteDrop(topicRunnerStatus)
		}
	})
}

func (h *Hub) SubscribeOperation(userID int64) (<-chan model.Operation, func()) {
	ch := make(chan model.Operation, 8)
	id := h.add(userID, topicOperation, ch)
	return ch, func() { h.remove(id) }
}

func (h *Hub) PublishOperation(userID int64, ev model.Operation) {
	h.deliver(topicOperation, userID, func(s *subscriber) {
		c := s.ch.(chan model.Operation)
		select {
		case c <- ev:
		default:
			h.noteDrop(topicOperation)
		}
	})
}
