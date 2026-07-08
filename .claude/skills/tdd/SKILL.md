---
name: tdd
description: Test-Driven Development workflow. Use whenever the user asks for a test, says "add a test", "write a test", "test this", or asks to verify behavior with tests. Always write the test first, show it failing, then implement — no confirmation step.
allowed-tools: Read, Bash, Glob, Grep, Edit, Write
---

When the user asks for a test (new test, additional test case, bug reproduction, regression test), follow TDD strictly. Do not skip steps. Do not ask for confirmation between steps.

## Steps

1. **Write the test first.** Place it next to the code under test, matching the project's existing test conventions (framework, file naming, structure). Read a neighboring test file first to copy the convention exactly — never invent a new pattern.

2. **Run the test and confirm it fails.** Run only the new test (not the entire suite) using the project's test runner. The failure must be for the _right reason_:
   - Good: assertion failure, missing function/method, wrong return value.
   - Bad: syntax error, import error, test runner misconfiguration. Fix these and re-run before continuing.

3. **Show the developer the failing output.** Output a short block containing:
   - The test file path and the test name.
   - The exact failure message (1–10 lines, trimmed — do not paste full stack traces unless relevant).
   - One sentence: "Implementing now."

4. **Implement the minimum code to make the test pass.** Do not wait for confirmation. Do not refactor unrelated code. Do not add extra features.

5. **Run the test again and confirm it passes.** If it still fails, iterate on the implementation — never weaken the test to make it pass.

6. **Provide a `Proof:` block** with the passing-test command and output, per the project rule.

## Hard rules

- Never write the implementation before the test exists and has been seen failing.
- Never write a test that passes immediately — that means it's not testing what you think.
- Never ask "should I implement this now?" after step 3. The user already told you to add the test; implementation is implied.
- Never mock the thing under test. Mock only true external boundaries (network, clock, filesystem when irrelevant).
- If the user asks for a test for a _bug_, the test must reproduce the bug (fail on current code, pass after fix).
- If you cannot run the test (no test runner, no environment), say so explicitly before writing anything — do not pretend to have run it.
