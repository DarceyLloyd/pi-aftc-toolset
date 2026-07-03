---
name: go
description: Go programming conventions, error handling, concurrency patterns, and tooling. Use when writing or editing .go files, working with go.mod, goroutines, channels, or Go interfaces.
---

# Go

- Use `gofmt` formatting conventions.
- Prefer explicit error handling over panics.
- Use `context.Context` for cancellation and deadlines.
- Avoid global mutable state; prefer dependency injection.
- Interfaces should be small (1-3 methods) and defined at the call site.
- Use `defer` for resource cleanup.
- Goroutines must have clear lifecycle management.
- Channels close from the sender side.
- Use `go build`, `go test`, `go vet` for verification.
