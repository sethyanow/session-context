# Session Context Plugin

[![Version](https://img.shields.io/github/v/release/sethyanow/session-context)](https://github.com/sethyanow/session-context/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE.txt)

Session continuity and context recovery for Claude Code. Auto-tracks your work via hooks, survives autocompact, and generates rich continuation prompts.

## Features

- **Automatic Tracking**: Hooks capture file edits, todos, plans, and user decisions as you work
- **Session Handoffs**: Create explicit checkpoints with `/handoff` for seamless continuation
- **Autocompact Survival**: Session markers survive context summarization for automatic recovery
- **Rich Context Recovery**: `/start` gathers project state and can restore from handoffs
- **Optional Integrations**: Enhanced context from beads, claude-harness, claude-mem, and agent-mail

## Installation

```bash
# Clone the repository
git clone https://github.com/sethyanow/session-context.git

# Install dependencies
cd session-context/mcp
bun install
```

Add to your Claude Code plugins configuration.

## Commands

### `/start` - Session Startup

Gather project context and recover from previous sessions.

```
/start              # Normal session start
/start handoff=abc  # Restore specific handoff
```

### `/handoff` - Create Checkpoint

Create an explicit checkpoint before ending a session or when context is low.

```
/handoff
```

This generates a continuation prompt you can paste into your next session.

## How It Works

### Automatic Tracking

The plugin installs hooks that capture your work:

| Hook | Trigger | Captures |
|------|---------|----------|
| `track-edit.ts` | Edit, Write, NotebookEdit | Modified file paths |
| `track-todos.ts` | TodoWrite | Current todo list |
| `track-plan.ts` | ExitPlanMode | Full plan content |
| `track-qa.ts` | AskUserQuestion | User decisions |

Data is stored in `~/.claude/session-context/handoffs/`.

### Handoff Flow

1. During work, hooks maintain a **rolling checkpoint** with your current state
2. When ready to end a session, run `/handoff`
3. Plugin generates a **continuation prompt** with:
   - What you were doing
   - Key decisions made
   - Next steps to take
4. Copy the prompt for your next session
5. New session detects the session marker and auto-recovers

### Autocompact Survival

The continuation prompt includes a session marker:
```html
<!-- session:abc123 -->
```

This marker survives Claude's context summarization. When detected after autocompact, the plugin automatically loads full context from storage.

## MCP Tools

The plugin provides three MCP tools:

### `get_session_status`

Gather session startup data with optional handoff recovery.

```typescript
get_session_status({
  level: "full",      // minimal | standard | full
  handoff: "abc123"   // Optional: restore specific handoff
})
```

**Levels:**
- `minimal`: project, harness, beads counts
- `standard`: + beads_triage, agentmail
- `full`: + skill_usage, claude_mem references

### `create_handoff`

Create explicit checkpoint with continuation prompt.

```typescript
create_handoff({
  task: "Implementing user auth",
  summary: "Added login endpoint, working on JWT",
  nextSteps: ["Add token refresh", "Write tests"],
  decisions: ["Using JWT over sessions"],
  blockers: []
})
```

### `update_checkpoint`

Update rolling checkpoint (called by hooks).

```typescript
update_checkpoint({
  files: ["src/auth.ts"],
  todos: [...],
  plan: { path: "...", content: "..." }
})
```

## Integrations

The plugin auto-detects and enhances with optional integrations:

| Integration | Detection | Enhancement |
|-------------|-----------|-------------|
| **Git** | Always | Branch, uncommitted, recent commits |
| **Beads** | `.beads/` exists | Issue triage, actionable work |
| **Claude Harness** | `.claude-harness/` exists | Features, memory, loop state |
| **Agent Mail** | MCP configured | Inbox status, file reservations |
| **Claude-Mem** | MCP configured | Observation ID references |

## Configuration

Create `~/.claude/session-context/config.json`:

```json
{
  "checkpointTTL": "24h",
  "maxHandoffs": 10,
  "integrations": {
    "beads": true,
    "harness": true,
    "claudeMem": true,
    "agentMail": true
  },
  "tracking": {
    "files": true,
    "todos": true,
    "plans": true,
    "decisions": true
  }
}
```

## Storage

Data is stored in `~/.claude/session-context/`:

```
~/.claude/session-context/
├── config.json           # Plugin configuration
└── handoffs/
    ├── {hash}-current.json  # Rolling checkpoint (per-project)
    └── {id}.json            # Explicit handoffs
```

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed information about the branching strategy, release process, and development workflow.

### Quick Start

```bash
# Run the MCP server directly
cd mcp
bun run start

# Type check
bun run typecheck

# Build for distribution
bun run build
```

## Acknowledgments

This plugin builds on and integrates with several excellent projects:

- **[Beads](https://github.com/steveyegge/beads)** by [@steveyegge](https://github.com/steveyegge) - Dependency-aware issue tracking and task management
- **[Claude Harness](https://github.com/panayiotism/claude-harness)** by [@panayiotism](https://github.com/panayiotism) - Feature tracking and agentic loop management
- **[Claude-Mem](https://github.com/thedotmack/claude-mem)** by [@thedotmack](https://github.com/thedotmack) - Persistent memory and observation storage
- **[MCP Agent Mail](https://github.com/Dicklesworthstone/mcp_agent_mail)** by [@Dicklesworthstone](https://github.com/Dicklesworthstone) - Multi-agent coordination and messaging

Thanks to all these maintainers for their work on the Claude Code ecosystem!

## License

MIT
