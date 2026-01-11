#!/usr/bin/env bun

/**
 * SessionStart hook that injects an instruction to invoke /start skill when user sends "."
 *
 * This hook executes at session start and returns a JSON response with a systemMessage
 * that instructs Claude to recognize "." as a shortcut for invoking the /start skill.
 */

const instruction = {
  continue: true,
  systemMessage: `
When the user sends only a period "." as their message, immediately invoke the /start skill using the Skill tool before any other response.

Example:
user: "."
assistant: [Invokes Skill tool with skill: "start"]
`
};

console.log(JSON.stringify(instruction));
process.exit(0);
