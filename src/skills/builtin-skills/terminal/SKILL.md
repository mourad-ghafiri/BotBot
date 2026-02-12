# Terminal

Execute shell commands, download files, install packages, and manage background processes.

## Tools

- **terminal_exec** — Run a shell command and return stdout/stderr
- **terminal_background** — Start a long-running command in the background
- **terminal_output** — Get output from a background job
- **terminal_kill** — Terminate a background job
- **terminal_cwd** — Get or change the working directory

## Usage

- Default working directory is configured via `workspace` in skill config. Change with `terminal_cwd`.
- Files created by successful commands are auto-detected and sent to the user.
- Before using an external tool (ffmpeg, yt-dlp, pandoc, etc.), check with `which <tool>`. If missing, install via `brew install`, `pip install`, or static binary download.
- Set `timeout` to 120+ for downloads or conversions.
- Use `terminal_background` for commands that take minutes. Poll with `terminal_output`, kill with `terminal_kill` if stuck.
