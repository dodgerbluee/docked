package middleware

import (
	"bufio"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

// requestLogger wraps http.ResponseWriter to capture the status code.
type requestLogger struct {
	http.ResponseWriter
	status int
}

func (w *requestLogger) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

// Unwrap exposes the wrapped writer so http.NewResponseController can reach the
// real ResponseWriter. Without it every controller call made downstream fails
// with "feature not supported" once this middleware is in the chain - notably
// the runner SSE handlers, which clear the server-wide 30s WriteTimeout so a
// long log stream is not cut off at 30 seconds.
func (w *requestLogger) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

// Flush forwards to the underlying writer when it supports flushing,
// keeping streaming responses (SSE-style) working through the wrapper.
func (w *requestLogger) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Hijack forwards to the underlying writer so WebSocket upgrades survive
// this middleware; without it the graphql-ws handshake fails with
// "response writer does not implement http.Hijacker".
func (w *requestLogger) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("underlying ResponseWriter does not implement http.Hijacker")
	}
	conn, bufrw, err := hj.Hijack()
	if err == nil {
		w.status = http.StatusSwitchingProtocols
	}
	return conn, bufrw, err
}

// Logger logs every request at INFO level. When debug logging is active
// (slog default level <= Debug) it also logs the request ID and latency
// at DEBUG level for easier tracing.
func Logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &requestLogger{ResponseWriter: w, status: http.StatusOK}

		next.ServeHTTP(rw, r)

		latency := time.Since(start)
		reqID := middleware.GetReqID(r.Context())

		slog.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.status,
			"latency_ms", latency.Milliseconds(),
		)

		slog.Debug("request detail",
			"request_id", reqID,
			"method", r.Method,
			"path", r.URL.Path,
			"query", r.URL.RawQuery,
			"status", rw.status,
			"latency_ms", latency.Milliseconds(),
			"remote_addr", r.RemoteAddr,
			"user_agent", r.UserAgent(),
		)
	})
}
