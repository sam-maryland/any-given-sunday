package chttp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

func NewJSONRequest(ctx context.Context, method, url string, body any) (req *http.Request, err error) {
	b := new(bytes.Buffer)
	if body != nil {
		err = json.NewEncoder(b).Encode(body)
		if err != nil {
			return nil, err
		}
	}
	req, err = http.NewRequestWithContext(ctx, method, url, b)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	return req, err
}

func JSONResponder(res *http.Response, err error, v any) error {
	if err != nil {
		return err
	}
	if res == nil {
		return errors.New("error in JSONReponder: incoming response was nil")
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return err
	}
	if v == nil {
		return nil
	}
	return json.NewDecoder(res.Body).Decode(&v)
}
