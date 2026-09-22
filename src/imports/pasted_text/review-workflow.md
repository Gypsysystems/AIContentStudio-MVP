FIX THE REVIEW PIPELINE LOGIC AND AUTHOR RESOLUTION WORKFLOW

Modify ONLY the Review workflow and its interaction with Author mode.

Do not modify Publish, Theme, Sources, Analysis, TOC, Knowledge Map, or general Authoring functionality.

GOAL

AI reviews the generated documentation against:

- uploaded source material
- approved Style / Brand profile
- documentation standards
- terminology
- content structure

AI creates actionable findings.

The human author decides what to do with every finding.

AI must never silently modify authored content.

==================================================
1. REVIEW PIPELINE
==================================================

Use this simplified workflow:

AI Review
→ Author Resolution
→ Complete

Do not use a separate "Self-review topics approved" counter unless an explicit self-review stage exists.

Remove misleading completion metrics.

==================================================
2. FINDING STATES
==================================================

Each finding must have one of these states:

Open

In Review

Resolved

Dismissed

Do not mark a finding Resolved simply because the author opened it.

==================================================
3. FINDING TYPES
==================================================

Support examples such as:

Unsupported Statement

Source Coverage Gap

Terminology Inconsistency

Writing Style

Grammar / Spelling

Structure Completeness

Missing Visual

Missing Expected Result

Broken Cross-reference

Style / Formatting Issue

==================================================
4. FINDING ACTIONS
==================================================

Depending on finding type provide relevant actions:

Fix

Jump to Content

View Evidence

Add Source

Ask AI

Dismiss

Mark Not Applicable

Do not show meaningless actions.

==================================================
5. FIX ACTION
==================================================

When author clicks Fix:

- switch to Author stage
- open Content workspace
- select exact affected topic
- scroll to exact affected content
- highlight the relevant text/block
- show a compact Review task card

Example:

Reviewing:
Passive voice detected

Actions:

AI Suggestion
Edit Manually
Resolve
Dismiss
Back to Review

==================================================
6. AI SUGGESTION
==================================================

If AI proposes replacement text:

show:

Original

Suggested

Actions:

Apply
Edit Suggestion
Discard

Apply must actually replace only the affected content.

The operation must support Undo.

==================================================
7. MANUAL EDITING
==================================================

Author can edit the content normally.

After editing provide:

Recheck Finding

AI re-evaluates ONLY the affected finding.

If issue is corrected:

Resolved

If not:

Still requires attention

Do not automatically claim resolution.

==================================================
8. SOURCE FINDINGS
==================================================

For unsupported statements or source gaps provide:

View Evidence

Search Existing Sources

Add Source

Edit Statement

Remove Statement

Dismiss with Reason

Do not fabricate evidence.

==================================================
9. DISMISS
==================================================

Dismiss requires optional reason:

Intentional

Not applicable

False positive

Approved exception

Other

Dismissed findings no longer count as unresolved.

Keep decision in Review history.

==================================================
10. RETURN TO REVIEW
==================================================

When entered from Review, Author mode must show:

Back to Review

Return to the same finding/scroll position.

Preserve all finding states.

==================================================
11. REVIEW COUNTS
==================================================

Show:

Open

Resolved

Dismissed

Example:

6 findings

1 Open
4 Resolved
1 Dismissed

Do not use arbitrary quality percentages.

==================================================
12. COMPLETE LOGIC
==================================================

Do NOT show:

"Review complete"

while required findings remain unresolved.

Completion rule:

Critical issues:
must be Resolved or Dismissed

Warnings:
must be Resolved or Dismissed if configured as required

Suggestions:
may remain open

If one required finding remains:

show:

"1 finding requires attention before review completion."

==================================================
13. MARK COMPLETE
==================================================

Only enable:

Complete Review

when completion rules are satisfied.

When complete show:

Review complete

Summary:

Resolved
Dismissed
Remaining suggestions

Do not display contradictory values such as:

Review Complete
and
5 / 6 resolved.

==================================================
14. PUBLISH
==================================================

If Review is not complete and user navigates to Publish:

show warning:

"Required review findings remain unresolved."

Actions:

Return to Review

Continue Anyway

Do not permanently block publishing.

==================================================
15. ACCEPTANCE TEST
==================================================

Create six findings.

Resolve four.

Dismiss one.

Leave one required warning Open.

VERIFY:

Review is NOT marked complete.

Complete Review disabled.

Fix final finding.

Recheck.

VERIFY:

finding becomes Resolved.

Review now shows Complete.

Counts must equal:

5 Resolved
1 Dismissed
0 Open

Then Publish becomes available normally.

==================================================
16. AUTHOR ROUND-TRIP TEST
==================================================

Open a finding.

Jump to Author.

Edit the exact content.

Recheck.

Return to Review.

VERIFY:

same review context preserved

finding state updated

no unrelated finding changed

==================================================
17. COMPLETION REPORT
==================================================

Report:

IMPLEMENTED

TESTED AND PASSED

NOT FULLY VALIDATED

Do not claim Review passed unless finding-state transitions were exercised.