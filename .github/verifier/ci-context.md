This review runs in the repository's CI, not in the harness that builds Chord, so three of the
inputs named above arrive in another form. Judge each criterion against these instead, and do
not withhold APPROVE only because the harness's form is absent.

- The bead: the pull request's title and body stand in for it. The body's Summary says what the
  change is for and its bead line names the unit of work; take the acceptance criteria from the
  Summary. When the body states no criterion a change could be checked against, that is a P2
  finding on the body, not a reason to guess.
- The verify log: the body's Evidence section lists the gate verify's steps and their exit codes
  on the head. Separately, the repository ruleset requires CI's lint, typecheck, full test suite,
  Windows build and leak scan to pass before any merge, so a failing step cannot merge whatever
  you decide. Treat the verify criterion as met unless the Evidence section shows a step failing.
- The standards: the harness's standards page is not in this repository. Apply the rules the
  prompt names (no swallowed errors, a test for each behaviour change, nothing unsafe) and the
  patterns of the code around the change, which your read-only tools can check.

There is no previous round here: every run reviews the whole diff of its head.
