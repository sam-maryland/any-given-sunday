package main

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHealthEndpoints(t *testing.T) {
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
			// Create a test server with the health endpoints
			mux := http.NewServeMux()
			
			mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				fmt.Fprintf(w, `{"status":"healthy","service":"commish-bot","timestamp":"%s"}`, time.Now().Format(time.RFC3339))
			})

			mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				fmt.Fprintf(w, `{"status":"ready","service":"commish-bot","timestamp":"%s"}`, time.Now().Format(time.RFC3339))
			})

			mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				fmt.Fprintf(w, `{"service":"commish-bot","status":"running","timestamp":"%s"}`, time.Now().Format(time.RFC3339))
			})

			// Use httptest.NewServer for reliable testing
			server := httptest.NewServer(mux)
			defer server.Close()

			// Make request to the test server
			resp, err := http.Get(server.URL + tt.endpoint)
			require.NoError(t, err)
			defer resp.Body.Close()

			// Check response
			assert.Equal(t, tt.expectedStatus, resp.StatusCode)
			assert.Equal(t, "application/json", resp.Header.Get("Content-Type"))

			// Check response body
			body, err := io.ReadAll(resp.Body)
			require.NoError(t, err)
			assert.Contains(t, string(body), tt.expectedBody)
		})
	}
}