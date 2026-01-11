# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - 2026-01-11

### Added
- Initial graduation from personal config
- Automatic session tracking via hooks (edits, todos, plans, decisions)
- Session handoff functionality for explicit checkpoints
- Autocompact survival with session markers
- Rich context recovery with `/start` and `/handoff` commands
- MCP tools: `get_session_status`, `create_handoff`, `update_checkpoint`
- Integrations with beads, claude-harness, claude-mem, and agent-mail
- Configuration support via `~/.claude/session-context/config.json`
- Rolling checkpoint storage per project
- Git status and branch tracking
- Documentation and installation guide

[0.0.1]: https://github.com/sethyanow/session-context/releases/tag/v0.0.1
