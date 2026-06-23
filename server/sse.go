package main

import (
	"fmt"
	"net/http"
	"sync"
)

type Hub struct {
	mu   sync.Mutex
	subs map[string]map[chan string]bool // familyID -> set of subscriber channels
}

func newHub() *Hub {
	return &Hub{subs: make(map[string]map[chan string]bool)}
}

func (h *Hub) Subscribe(familyID string) (chan string, func()) {
	ch := make(chan string, 4)
	h.mu.Lock()
	if h.subs[familyID] == nil {
		h.subs[familyID] = make(map[chan string]bool)
	}
	h.subs[familyID][ch] = true
	h.mu.Unlock()

	cancel := func() {
		h.mu.Lock()
		delete(h.subs[familyID], ch)
		h.mu.Unlock()
		close(ch)
	}
	return ch, cancel
}

// Broadcast notifies every subscriber for familyID that something changed.
// It never blocks: a subscriber with a full buffer just misses this signal
// and catches up on its next periodic /api/sync poll.
func (h *Hub) Broadcast(familyID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs[familyID] {
		select {
		case ch <- "changed":
		default:
		}
	}
}

func handleEvents(hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		session := sessionFrom(r)
		ch, cancel := hub.Subscribe(session.FamilyID)
		defer cancel()

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.WriteHeader(http.StatusOK)
		flusher.Flush()

		for {
			select {
			case <-r.Context().Done():
				return
			case msg, open := <-ch:
				if !open {
					return
				}
				fmt.Fprintf(w, "data: %s\n\n", msg)
				flusher.Flush()
			}
		}
	}
}
