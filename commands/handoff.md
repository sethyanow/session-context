---
description: Save session state and generate continuation prompt for next session
---

# /handoff - Create Session Checkpoint

Create an explicit checkpoint of your current work for seamless continuation in a new session.

## When to Use

- End of work session
- Before running a context-heavy operation
- When you want a clean continuation point
- Proactively, before context gets too full

## Process

1. **Gather Current State**
   - Read rolling checkpoint (files, todos, plan, decisions)
   - Check git status for uncommitted work
   - Get current task context

2. **Synthesize Summary**
   - What we were doing
   - Where we left off
   - What's next

3. **Create Handoff**
   Call the MCP tool:
   ```typescript
   create_handoff({
     task: "Brief description of current work",
     summary: "Where we are in the process",
     nextSteps: ["Immediate next action", "Following step"],
     decisions: ["Key decision 1", "Key decision 2"]
   })
   ```

4. **Present to User**
   Display the handoff confirmation and continuation prompt.

## Output Format

```
┌─────────────────────────────────────────────────────────────────┐
│  ✅ HANDOFF CREATED: {id}                                       │
├─────────────────────────────────────────────────────────────────┤
│  Task: {task}                                                   │
│  Files: {count} modified                                        │
│  Plan: {plan.path} (cached)                                     │
│  Decisions: {count} captured                                    │
│  Todos: {count} items ({in_progress} in progress)              │
├─────────────────────────────────────────────────────────────────┤
│  📋 CONTINUATION PROMPT                                         │
│  Copy this for your next session:                               │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ # Continue: {task}                                      │   │
│  │                                                          │   │
│  │ Resuming session {id}.                                   │   │
│  │                                                          │   │
│  │ ## Context                                               │   │
│  │ - Working on: {summary}                                  │   │
│  │ - Key decision: {decisions[0]}                           │   │
│  │ - Blocked on: {blockers[0] || "Nothing"}                │   │
│  │                                                          │   │
│  │ ## Next Steps                                            │   │
│  │ 1. {nextSteps[0]}                                       │   │
│  │ 2. {nextSteps[1]}                                       │   │
│  │                                                          │   │
│  │ Run /start to load full context and continue.           │   │
│  │ <!-- session:{id} -->                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Integration with Harness

If claude-harness is available, the handoff also:
- Updates `working-context.json`
- Records decisions to episodic memory
- Does NOT commit, push, or run tests (save that for fresh session)

## Tips

- **Be specific** with the task description - it's the headline for recovery
- **Include blockers** if any - helps future Claude understand constraints
- **List concrete next steps** - actionable items for immediate resumption

## Recovery

When starting a new session, paste the continuation prompt. Claude will:
1. Detect the session marker
2. Call `/start` with the handoff ID
3. Load full context from storage
4. Resume work seamlessly
