package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHubBroadcastDeliversToSubscriber(t *testing.T) {
	h := newHub()
	ch, cancel := h.Subscribe("fam1")
	defer cancel()

	h.Broadcast("fam1")

	select {
	case msg := <-ch:
		if msg != "changed" {
			t.Errorf("msg = %q, want changed", msg)
		}
	default:
		t.Fatal("expected a message, got none")
	}
}

func TestHubBroadcastDoesNotCrossFamilies(t *testing.T) {
	h := newHub()
	chA, cancelA := h.Subscribe("famA")
	defer cancelA()
	chB, cancelB := h.Subscribe("famB")
	defer cancelB()

	h.Broadcast("famA")

	select {
	case <-chA:
	default:
		t.Fatal("famA subscriber should have received a message")
	}
	select {
	case <-chB:
		t.Fatal("famB subscriber should NOT have received a message")
	default:
	}
}

func TestHubCancelRemovesSubscriber(t *testing.T) {
	h := newHub()
	_, cancel := h.Subscribe("fam1")
	cancel()

	if len(h.subs["fam1"]) != 0 {
		t.Fatalf("expected 0 subscribers after cancel, got %d", len(h.subs["fam1"]))
	}
}

func TestHandleEventsStreamsBroadcast(t *testing.T) {
	hub := newHub()
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest("GET", "/api/events", nil)
	req = req.WithContext(context.WithValue(ctx, ctxSessionKey, SessionInfo{FamilyID: "fam1"}))
	rec := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		handleEvents(hub)(rec, req)
		close(done)
	}()

	time.Sleep(20 * time.Millisecond) // let the handler subscribe
	hub.Broadcast("fam1")
	time.Sleep(20 * time.Millisecond) // let the write land in rec.Body

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("handleEvents did not return after context cancellation")
	}

	if !strings.Contains(rec.Body.String(), "data: changed") {
		t.Fatalf("expected SSE body to contain 'data: changed', got %q", rec.Body.String())
	}
}

// TestHandleEventsThroughStatusWriter exercises handleEvents behind the same
// statusWriter that logMiddleware wraps every response in. A bare
// httptest.ResponseRecorder implements http.Flusher directly and would miss
// a wrapper that fails to forward it.
func TestHandleEventsThroughStatusWriter(t *testing.T) {
	hub := newHub()
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest("GET", "/api/events", nil)
	req = req.WithContext(context.WithValue(ctx, ctxSessionKey, SessionInfo{FamilyID: "fam1"}))
	rec := httptest.NewRecorder()
	sw := &statusWriter{ResponseWriter: rec, status: http.StatusOK}

	done := make(chan struct{})
	go func() {
		handleEvents(hub)(sw, req)
		close(done)
	}()

	time.Sleep(20 * time.Millisecond)
	hub.Broadcast("fam1")
	time.Sleep(20 * time.Millisecond)

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("handleEvents did not return after context cancellation")
	}

	if !strings.Contains(rec.Body.String(), "data: changed") {
		t.Fatalf("expected SSE body to contain 'data: changed', got %q", rec.Body.String())
	}
}
