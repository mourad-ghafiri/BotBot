/**
 * Skill creator — create, list, get, update, delete, and reload custom skills.
 * Standalone module: receives registry reference via _init().
 */

const fs = require('fs');
const path = require('path');

let _registry = null;
let _customDir = null;

function _init(registry, customDir) {
  _registry = registry;
  _customDir = customDir;
}

function _writeToolsJson(skillDir, name, description, tools, metadata) {
  const data = { name, description };
  if (tools && tools.length) data.tools = tools;
  if (metadata && Object.keys(metadata).length) data.metadata = metadata;
  fs.writeFileSync(path.join(skillDir, 'tools.json'), JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function _writeSkillMd(skillDir, name, description, instructions, tools) {
  let md = `# ${name}\n\n${description || ''}\n`;
  if (tools && tools.length) {
    md += '\n## Tools\n\n';
    for (const t of tools) {
      md += `- **${t.name}** — ${t.description || ''}\n`;
    }
  }
  if (instructions) {
    md += `\n## Usage\n\n${instructions}\n`;
  }
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), md, 'utf-8');
}

async function skill_create(args) {
  const name = args.name;
  if (!name) return 'Error: name is required.';
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) return 'Error: invalid skill name.';
  if (!_customDir) return 'Error: skill creator not initialized.';

  const skillDir = path.join(_customDir, name);
  if (fs.existsSync(skillDir)) return `Error: skill '${name}' already exists.`;

  fs.mkdirSync(skillDir, { recursive: true });
  const scriptsDir = path.join(skillDir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });

  // Write tools.json
  _writeToolsJson(skillDir, name, args.description || '', args.tools || [], args.metadata || {});

  // Write SKILL.md
  _writeSkillMd(skillDir, name, args.description || '', args.instructions || '', args.tools || []);

  // Write script if provided
  if (args.script) {
    const scriptPath = path.join(scriptsDir, `${name.replace(/-/g, '_')}.js`);
    fs.writeFileSync(scriptPath, args.script, 'utf-8');
  }

  // Register with registry
  if (_registry) {
    try { _registry.registerDynamic(name); } catch (err) {
      return `Skill files created but registration failed: ${err.message}`;
    }
  }

  return `Skill '${name}' created and activated.`;
}

async function skill_list() {
  if (!_customDir) return 'Error: skill creator not initialized.';
  if (!fs.existsSync(_customDir)) return 'No custom skills.';

  const entries = fs.readdirSync(_customDir, { withFileTypes: true });
  const skills = entries
    .filter((e) => e.isDirectory() && (
      fs.existsSync(path.join(_customDir, e.name, 'tools.json')) ||
      fs.existsSync(path.join(_customDir, e.name, 'SKILL.md'))
    ))
    .map((e) => e.name);

  if (!skills.length) return 'No custom skills found.';
  return skills.map((s) => `- ${s}`).join('\n');
}

async function skill_get(args) {
  if (!args.name) return 'Error: name is required.';
  if (!_customDir) return 'Error: skill creator not initialized.';
  const skillDir = path.join(_customDir, args.name);
  if (!fs.existsSync(skillDir)) return `Error: skill '${args.name}' not found.`;

  let result = '';

  // Read tools.json
  const toolsJsonPath = path.join(skillDir, 'tools.json');
  if (fs.existsSync(toolsJsonPath)) {
    result += '## tools.json\n```json\n' + fs.readFileSync(toolsJsonPath, 'utf-8') + '```\n\n';
  }

  // Read SKILL.md
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  if (fs.existsSync(skillMdPath)) {
    result += '## SKILL.md\n' + fs.readFileSync(skillMdPath, 'utf-8');
  }

  return result || `Error: skill '${args.name}' has no definition files.`;
}

async function skill_update(args) {
  if (!args.name) return 'Error: name is required.';
  if (!_customDir) return 'Error: skill creator not initialized.';
  const skillDir = path.join(_customDir, args.name);
  if (!fs.existsSync(skillDir)) return `Error: skill '${args.name}' not found.`;

  // Read existing tools.json
  const toolsJsonPath = path.join(skillDir, 'tools.json');
  let existing = {};
  if (fs.existsSync(toolsJsonPath)) {
    try { existing = JSON.parse(fs.readFileSync(toolsJsonPath, 'utf-8')); } catch {}
  }

  // Update fields
  const description = args.description || existing.description || '';
  const tools = args.tools || existing.tools || [];
  const metadata = args.metadata ? { ...(existing.metadata || {}), ...args.metadata } : (existing.metadata || {});

  // Write updated tools.json
  _writeToolsJson(skillDir, args.name, description, tools, metadata);

  // Update SKILL.md if instructions provided
  if (args.instructions) {
    _writeSkillMd(skillDir, args.name, description, args.instructions, tools);
  }

  // Update script if provided
  if (args.script) {
    const scriptsDir = path.join(skillDir, 'scripts');
    if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(path.join(scriptsDir, `${args.name.replace(/-/g, '_')}.js`), args.script, 'utf-8');
  }

  if (_registry) {
    try { _registry.reload(args.name); } catch {}
  }

  return `Skill '${args.name}' updated.`;
}

async function skill_delete(args) {
  if (!args.name) return 'Error: name is required.';
  if (!_customDir) return 'Error: skill creator not initialized.';
  const skillDir = path.join(_customDir, args.name);
  if (!fs.existsSync(skillDir)) return `Error: skill '${args.name}' not found.`;

  if (_registry) {
    try { _registry.unregister(args.name); } catch {}
  }

  fs.rmSync(skillDir, { recursive: true, force: true });
  return `Skill '${args.name}' deleted.`;
}

async function skill_reload(args) {
  if (!_registry) return 'Error: skill creator not initialized.';

  if (args.name) {
    try {
      _registry.reload(args.name);
      return `Skill '${args.name}' reloaded.`;
    } catch (err) {
      return `Error reloading skill '${args.name}': ${err.message}`;
    }
  }

  try {
    _registry.reloadAll();
    return 'All skills reloaded.';
  } catch (err) {
    return `Error reloading skills: ${err.message}`;
  }
}

module.exports = { _init, skill_create, skill_list, skill_get, skill_update, skill_delete, skill_reload };

// CLI entry point
if (require.main === module) {
  const toolName = process.argv[2];
  const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};
  const handlers = { skill_create, skill_list, skill_get, skill_update, skill_delete, skill_reload };
  const handler = handlers[toolName];
  if (!handler) { console.error(`Unknown tool: ${toolName}`); process.exit(1); }
  handler(args).then((r) => console.log(r)).catch((e) => { console.error(e); process.exit(1); });
}
