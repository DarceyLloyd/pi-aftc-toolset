---
name: develop-tdd
description: Test-driven development with the red-green-refactor loop. Tests verify behavior through public interfaces, not implementation details. Use when implementing a new feature or fixing a bug, when the user asks for TDD, or when writing tests for a change.
---

# Develop TDD

**Hard gate:** Do NOT proceed if on `main` or `master`. Create a feature branch first (use `kickoff-branch` if available).

**Hard gate:** Do NOT write code before you have a plan. Write the verify steps (what proves the code works) before the code that makes them pass.

## Philosophy

Tests verify behavior through public interfaces, not implementation details. A good test reads like a specification. Tests are documentation that runs.

## Red Flags

If you catch yourself thinking these, stop and reconsider - you are likely deviating from production-grade craft.

- "This is too simple to need tests." - Simple code is where bugs hide. If it's simple, the test is cheap.
- "I'll refactor this later." - "Later" is when technical debt becomes bankruptcy. Refactor while green.
- "The tests are already comprehensive." - If you're adding behavior, you need a new test. Coverage ≠ correctness.
- "I'm just fixing a small bug." - Small bugs often indicate deep interface flaws. Investigate root cause.
- "I need to mock this internal class." - Mocking internals couples tests to implementation. Mock only I/O.
- "This refactor is out of scope." - Leave the code cleaner than you found it (Boy Scout Rule).

## Workflow

### 1. Planning

- Confirm interface changes and behaviors to test (prioritize).
- Design interfaces for testability - keep modules deep (powerful, simple interface).
- Get user approval on the plan.

### 2. Tracer Bullet

Write ONE test that confirms ONE thing about the system:

```
RED:    Write test for first behavior → test fails → commit: test(<scope>): ...
GREEN:  Write minimal code to pass → test passes → commit: feat(<scope>): ...
REFACTOR (optional): clean up → commit: refactor(<scope>): ...
```

### 3. Incremental Loop

For each remaining behavior: RED → GREEN → REFACTOR (optional). One test at a time. Commit after every GREEN phase.

### 4. Visual Slices (UI alternate workflow)

For UI components where behavioral unit testing is brittle: extract logic into a Controller/ViewModel/Hook (pure TDD), then use Visual Slices for the View layer.

### 5. Refactor

After all tests pass: extract duplication, deepen modules, apply SOLID principles. **Never refactor while RED.**

### 6. Verify

After every behavior cycle, run the verify command for the current step. Show evidence before declaring the step done.

### 7. Manual Verification Handover

Once all tests pass: present the verification steps to the user one at a time, and wait for confirmation of behavioral correctness.

## Checklist Per Cycle

- Test describes behavior, not implementation
- No test is ignored without an explicit ambiguity note
- Boundary conditions tested: empty, max, min, off-by-one
- Tests verify behavior through public interface only - no private methods
- Test would survive internal refactor
- Code is minimal for this test
- No speculative features added
- Every new abstraction has an explicit "Reason for Depth" justification
- Progress committed (Conventional Commits)
- `verify:` command passes

## Anti-Patterns

- Horizontal slicing: testing a single feature across all layers at once. This couples tests to implementation. Vertical slicing: build a complete thin slice (UI + logic + tests) end-to-end, then deepen.
- Testing implementation details: testing that a private method was called, or that a specific SQL query was issued. Test the public behavior.
- Mocking internal classes: couples tests to the class structure. Mock only I/O boundaries.
