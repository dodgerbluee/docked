package model

import (
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"time"

	"github.com/99designs/gqlgen/graphql"
)

// DateTime is a custom scalar for ISO-8601 timestamps.
type DateTime time.Time

func MarshalDateTime(t time.Time) graphql.Marshaler {
	return graphql.WriterFunc(func(w io.Writer) {
		io.WriteString(w, strconv.Quote(t.Format(time.RFC3339)))
	})
}

func UnmarshalDateTime(v any) (time.Time, error) {
	s, ok := v.(string)
	if !ok {
		return time.Time{}, fmt.Errorf("DateTime must be a string, got %T", v)
	}
	return time.Parse(time.RFC3339, s)
}

// BigInt is a custom scalar for 64-bit integers (e.g. byte sizes).
type BigInt int64

func MarshalBigInt(i BigInt) graphql.Marshaler {
	return graphql.WriterFunc(func(w io.Writer) {
		io.WriteString(w, strconv.FormatInt(int64(i), 10))
	})
}

func UnmarshalBigInt(v any) (BigInt, error) {
	switch n := v.(type) {
	case int64:
		return BigInt(n), nil
	case float64:
		return BigInt(n), nil
	case string:
		i, err := strconv.ParseInt(n, 10, 64)
		if err != nil {
			return 0, fmt.Errorf("invalid BigInt: %w", err)
		}
		return BigInt(i), nil
	default:
		return 0, fmt.Errorf("BigInt must be a number, got %T", v)
	}
}

// JSON is a custom scalar for arbitrary JSON values.
type JSON map[string]any

func MarshalJSON(j JSON) graphql.Marshaler {
	return graphql.WriterFunc(func(w io.Writer) {
		data, _ := json.Marshal(j)
		w.Write(data)
	})
}

func UnmarshalJSON(v any) (JSON, error) {
	m, ok := v.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("JSON must be an object, got %T", v)
	}
	return JSON(m), nil
}

// Upload carries a file submitted through the multipart form request spec.
// The transport injects a graphql.Upload into the variable slot; UnmarshalUpload
// converts it into this model so resolvers can stream the file.
type Upload struct {
	Filename    string
	ContentType string
	Size        int64
	Stream      io.Reader
}

func MarshalUpload(u Upload) graphql.Marshaler {
	return graphql.WriterFunc(func(w io.Writer) {
		io.WriteString(w, "null")
	})
}

func UnmarshalUpload(v any) (Upload, error) {
	if u, ok := v.(graphql.Upload); ok {
		return Upload{
			Filename:    u.Filename,
			ContentType: u.ContentType,
			Size:        u.Size,
			Stream:      u.File,
		}, nil
	}
	return Upload{}, fmt.Errorf("uploadAvatar requires a multipart/form-data request (graphql-multipart-request-spec)")
}
