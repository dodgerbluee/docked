package graph

import (
	"context"
	"testing"
)

// The transport InitFunc stashes a context.CancelFunc under WSDisconnectKey;
// the watchdog and the per-operation guard both rely on finding it. An
// assertion on the wrong func shape (func() vs context.CancelFunc) silently
// returns nil and the connection is never torn down.
func TestWSDisconnectFromContextFindsCancelFunc(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctx = context.WithValue(ctx, WSDisconnectKey{}, cancel)

	f := WSDisconnectFromContext(ctx)
	if f == nil {
		t.Fatal("WSDisconnectFromContext returned nil for a context carrying a CancelFunc")
	}
	f()
	select {
	case <-ctx.Done():
	default:
		t.Error("disconnect func did not cancel the connection context")
	}
}

func TestWSDisconnectFromContextNilForPlainContext(t *testing.T) {
	if f := WSDisconnectFromContext(context.Background()); f != nil {
		t.Error("plain context should yield nil")
	}
}
