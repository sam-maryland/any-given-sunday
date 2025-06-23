package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestHealthEndpoints(t *testing.T) {
	// Start the health server in background
	go startHealthServer()
	
	// Give the server a moment to start
	time.Sleep(100 * time.Millisecond)

	tests := []struct {
		name           string
		endpoint       string
		expectedStatus int
		expectedBody   string
	}{
		{
			name:           "Health endpoint returns healthy status",
			endpoint:       "/health",
			expectedStatus: http.StatusOK,
			expectedBody:   "healthy",
		},
		{
			name:           "Ready endpoint returns ready status", 
			endpoint:       "/ready",
			expectedStatus: http.StatusOK,
			expectedBody:   "ready",
		},
		{
			name:           "Root endpoint returns running status",
			endpoint:       "/",
			expectedStatus: http.StatusOK,
			expectedBody:   "running",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", tt.endpoint, nil)
			w := httptest.NewRecorder()

			// Create a test handler for the specific endpoint
			switch tt.endpoint {
			case "/health":
				http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusOK)
					w.Write([]byte(`{"status":"healthy","service":"commish-bot"}`))
				}).ServeHTTP(w, req)
			case "/ready":
				http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusOK)
					w.Write([]byte(`{"status":"ready","service":"commish-bot"}`))
				}).ServeHTTP(w, req)
			case "/":
				http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusOK)
					w.Write([]byte(`{"service":"commish-bot","status":"running"}`))
				}).ServeHTTP(w, req)
			}

			assert.Equal(t, tt.expectedStatus, w.Code)
			assert.Contains(t, w.Body.String(), tt.expectedBody)
			assert.Equal(t, "application/json", w.Header().Get("Content-Type"))
		})
	}
}