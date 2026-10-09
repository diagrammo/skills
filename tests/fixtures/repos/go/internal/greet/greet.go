package greet

import "strings"

// Greet returns a shouted greeting.
func Greet(name string) string {
	return strings.ToUpper("hello, " + name)
}
