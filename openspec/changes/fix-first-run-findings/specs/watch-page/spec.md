## ADDED Requirements

### Requirement: Readable spacing

Stacked headings, text and lists on the page SHALL keep the spacing their container sets.

#### Scenario: Empty page

- **WHEN** the page opens before setup
- **THEN** the heading, the explanation and Set up Watch are visibly separated

### Requirement: Ask why without a clipboard

When the browser cannot write to the clipboard, Ask why SHALL show the question on the page for
the person to copy.

#### Scenario: Plain-HTTP address

- **WHEN** the page is opened over plain HTTP on a tailnet name and the person presses Ask why
- **THEN** the page shows the question text

### Requirement: Make a signing secret

The Alerts section on the page SHALL offer Make a signing secret. Pressing it SHALL store a new
random secret, replacing any earlier one, and show it once with a note that alerts fail until the
same secret is pasted into the T3 task. While alerts are on, replacing the secret SHALL ask for a
second press first. The chat view SHALL NOT offer it.

#### Scenario: Making a secret

- **WHEN** the person presses Make a signing secret
- **THEN** the page shows a 64-character secret once and Alerts reports signed

### Requirement: Folder list shows configured folders

The folder list under Details SHALL show the folders in the config, before and after any scan.
When the config cannot be read, it SHALL say so and SHALL NOT offer the last scan's folders.

#### Scenario: Folders changed after a scan

- **WHEN** the person saves a new folder list
- **THEN** the list shows the saved folders, not the folders the last scan read
