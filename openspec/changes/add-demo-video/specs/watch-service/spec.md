## ADDED Requirements

### Requirement: Record the demo from the demo install

The repository SHALL hold a script that records the README's demo video from `t3-watch demo`, with
its sample data only, and SHALL reach no Watch but the demo it starts. The video SHALL run about 60
seconds and show, with captions, the demo starting, Home with the broken check and the agent's
note, turning on a check the agent wrote, the products and their checks, Details with a key and a
signed test alert, and the demo stopping. The README SHALL show the video.

#### Scenario: Recording it again

- **WHEN** someone with Chrome and ffmpeg runs the script after `pnpm build`
- **THEN** it writes `docs/demo.mp4` and `docs/demo.gif`, and no demo process or folder is left
  behind

#### Scenario: A missing tool

- **WHEN** Chrome or ffmpeg is not found
- **THEN** the script stops before starting the demo and says which one is missing
