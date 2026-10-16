package graph

import (
	"regexp"
	"strings"
	"testing"
)

var bootstrapSecretPattern = regexp.MustCompile(`^[A-Z0-9!@#$%&*+=?-]{4}-[A-Z0-9!@#$%&*+=?-]{4}-[A-Z0-9!@#$%&*+=?-]{4}$`)

func TestGenerateBootstrapSecretFormat(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 20; i++ {
		s, err := generateBootstrapSecret(registrationCodeAlphabet)
		if err != nil {
			t.Fatalf("generateBootstrapSecret: %v", err)
		}
		if !bootstrapSecretPattern.MatchString(s) {
			t.Fatalf("secret %q does not match XXXX-XXXX-XXXX", s)
		}
		if strings.ContainsAny(s, "0OIl1") {
			t.Errorf("secret %q contains excluded confusing characters", s)
		}
		seen[s] = true
	}
	if len(seen) < 19 {
		t.Errorf("expected near-unique secrets, got %d unique out of 20", len(seen))
	}
}

func TestIsValidEmailFormat(t *testing.T) {
	valid := []string{"a@b.co", "first.last+tag@sub.example.com", strings.Repeat("a", 60) + "@" + strings.Repeat("b", 189) + ".com"} // exactly 254 chars
	for _, e := range valid {
		if !isValidEmailFormat(e) {
			t.Errorf("isValidEmailFormat(%q) = false, want true", e)
		}
	}
	invalid := []string{"", "no-at-sign", "a@b", "a@@b.com", "a b@c.com", strings.Repeat("a", 250) + "@b.com"}
	for _, e := range invalid {
		if isValidEmailFormat(e) {
			t.Errorf("isValidEmailFormat(%q) = true, want false", e)
		}
	}
}
