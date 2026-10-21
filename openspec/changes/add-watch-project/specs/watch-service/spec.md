## ADDED Requirements

### Requirement: A Watch project in T3 Code

`t3-watch install` SHALL make a folder for the Watch thread outside Watch's data folder, holding
an `AGENTS.md` and a `CLAUDE.md` that say what it is for, written only when missing, and SHALL
add that folder to T3 Code as a project named Watch with `t3 project add`. A Watch project T3
already has, found by its folder or by Watch's note in it, SHALL be left as it is, unless its
folder was deleted outright, which install makes again. Install SHALL write nothing unless the
`t3` command answers as T3 Code's, SHALL say when T3 Code is not installed and carry on, SHALL
refuse when Watch's own folder holds the whole home folder, and SHALL skip the step with
`--no-project`. `t3-watch uninstall` SHALL leave the project, its threads and its folder in place
and say how to remove the project.

#### Scenario: First install with T3 Code

- **WHEN** T3 Code is installed and the person runs `t3-watch install`
- **THEN** T3 lists a project named Watch whose folder holds only those two notes, and install
  says to start a thread there

#### Scenario: Installed again

- **WHEN** the Watch project already exists and the person runs `t3-watch install` again
- **THEN** install says the project is already there and changes nothing in it

#### Scenario: A repository named Watch

- **WHEN** the person has a repository project that T3 titled Watch
- **THEN** install adds Watch's own project beside it rather than mistaking that one for it
