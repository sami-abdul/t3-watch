## ADDED Requirements

### Requirement: A rescan respects edits and deletions

A rescan SHALL redefine only checks it made. It SHALL NOT define, run or suggest a check the
person deleted, even one deleted while it runs, SHALL leave a draft to Home, and SHALL keep the
intent, settings and cadence of a check an agent drafted or the person edited, updating only the
key it uses. The review SHALL leave deleted checks out, and apply SHALL leave them deleted and
name each one it was asked to turn on. A drafted check SHALL NOT take the id of a deleted one.

#### Scenario: A deleted suggestion stays gone

- **WHEN** the person deletes a check the scan suggested, then scans again
- **THEN** the review does not list it and Home does not count it as new
