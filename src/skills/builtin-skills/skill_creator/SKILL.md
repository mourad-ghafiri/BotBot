# Skill Creator

Create and manage custom skills so the bot can learn new capabilities.

## Tools

- **skill_create** — Create a new custom skill with tools.json, SKILL.md, and a script
- **skill_list** — List all custom (non-builtin) skills
- **skill_get** — Get the definition of a skill (tools.json + SKILL.md)
- **skill_update** — Update a custom skill's description, instructions, tools, or script
- **skill_delete** — Delete a custom skill
- **skill_reload** — Reload one or all skills from disk

## Skill Directory Structure

A custom skill is a directory under `workspace/skills/`:
```
workspace/skills/my-skill/
├── SKILL.md           # Instructions (pure markdown, no frontmatter)
├── tools.json         # Tool definitions (name, description, tools[])
└── scripts/
    └── my_skill.js    # Handler for each tool
```

### tools.json format
```json
{
  "name": "my_skill",
  "description": "What the skill does and when to use it.",
  "tools": [
    {
      "name": "myskill_run",
      "description": "What this tool does.",
      "input_schema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "The query." }
        },
        "required": ["query"]
      }
    }
  ]
}
```

### SKILL.md format
Pure markdown with skill name, description, tool list, and usage hints. No YAML frontmatter.

## How to Write the Script

Each tool defined in `tools.json` needs a matching handler function in the script:

```javascript
const fs = require('fs');

async function myskill_run(args) {
  const query = args.query || '';
  return `Result: ${query}`;
}

module.exports = { myskill_run };

if (require.main === module) {
  const toolName = process.argv[2];
  const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};
  const handlers = { myskill_run };
  const handler = handlers[toolName];
  if (!handler) { console.error(`Unknown tool: ${toolName}`); process.exit(1); }
  handler(args).then(r => console.log(r)).catch(e => { console.error(e); process.exit(1); });
}
```

## Rules

- Tool names should be prefixed with the skill name (e.g. `weather_forecast`, not `forecast`).
- The script MUST have a CLI entry point that reads `toolName` and `args` from argv.
- Naming: lowercase, a-z/0-9/hyphens/underscores, starts with a letter (e.g. `pdf-tools`).
- Builtin skills (terminal, browser, search, skill_creator) cannot be modified or deleted.
- You can create instruction-only skills (no tools/script) for workflow recipes that use existing builtin tools.
- Use `skill_reload` after manually editing skill files on disk to pick up changes.
