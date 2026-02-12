import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkillRegistryService } from '../skills/skill-registry.service';
import { ToolDefinition } from '../llm/llm.types';
import { getInternalTools } from './tools';

const GENERAL_BEHAVIOR = `## General Behavior
- Be concise and direct. Answer in the language the user writes in.
- Always use your tools to accomplish the user's request. Never refuse — figure it out using your available tools and skills.
- When a multi-step task succeeds, consider creating a skill so you can do it faster next time.`;

const FORMAT_TELEGRAM = `## Output Format — Telegram
You are writing for Telegram with parse_mode=HTML. Follow these rules strictly:
1. NEVER use Markdown. No **bold**, *italic*, # headings, - bullet lists, \`\`\` code blocks \`\`\`, or [links](url). Telegram does NOT render Markdown.
2. Use Telegram HTML tags ONLY when needed: <b>bold</b> for emphasis, <i>italic</i> for secondary info, <code>inline code</code> for commands, file names, or IDs.
3. Use emojis and line breaks for visual structure instead of headings or bullet points.`;

const FORMAT_WHATSAPP = `## Output Format — WhatsApp
You are writing for WhatsApp. Follow these rules:
1. Use WhatsApp formatting: *bold*, _italic_, \`\`\`code\`\`\`, ~strikethrough~.
2. Use emojis and line breaks for visual structure.
3. Keep messages concise — long messages are hard to read on mobile.`;

const FORMAT_PLAIN = `## Output Format
Use plain text. Keep messages concise and well-structured with line breaks.`;

const COMMON_WORKFLOWS = `## Common Workflows

Download video/audio:
1. Activate 'search' if URL not provided, then search_web to find it
2. Activate 'terminal', check tools: terminal_exec with 'which yt-dlp && which ffmpeg' — install missing
3. Video: terminal_exec with 'yt-dlp <URL>' and timeout: 180
4. Audio/MP3: terminal_exec with 'yt-dlp -x --audio-format mp3 <URL>' and timeout: 180
5. Files are auto-sent to the user

Screenshot a website:
1. Activate 'browser', browser_open the URL, then browser_screenshot

Create/learn a skill:
1. Activate 'skill_creator'
2. skill_create with name, description, instructions, tools (list of tool defs), and script (code)
3. If you completed a multi-step task that may recur, proactively create a skill so you can do it faster next time`;

const MEMORY_GUIDELINES = `### Guidelines
- Store facts worth remembering long-term: user preferences, personal details, project info, decisions, system changes.
- Do NOT store transient requests, greetings, or obvious context.
- Check memory (memory_retrieve) before asking questions the user may have already answered.
- Use descriptive tags for better retrieval later.`;

const TASK_GUIDELINES = `### Guidelines
- task_type 'reminder' sends a notification at the scheduled time; 'execution' runs the agent with full skill access (description is the prompt).
- Use scheduled_at (ISO datetime) for one-off tasks, cron_expression for recurring (e.g. "0 9 * * 1-5" for weekdays at 9 AM).
- To cancel a task, first call task_list (no status filter) to find the ID, then task_cancel.
- Cron/recurring tasks have status 'scheduled'.
- Tasks are scoped to the current user — you can only see and cancel your own tasks.`;

const SKILL_GUIDELINES = `### Guidelines
- You MUST call activate_skill before using any skill's tools.
- After activation, the skill's tools and usage instructions become available.
- Skills can be builtin (shipped with the bot) or custom (user-created).`;

function formatToolJson(tool: ToolDefinition): string {
  const obj = {
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  };
  return JSON.stringify(obj, null, 2);
}

function buildInternalToolsSection(): string {
  const tools = getInternalTools();

  const memoryTools = tools.filter((t) => t.name.startsWith('memory_'));
  const taskTools = tools.filter((t) => t.name.startsWith('task_'));
  const skillTools = tools.filter((t) => t.name === 'activate_skill');

  const sections: string[] = [];

  // Memory
  sections.push('## Memory Tools');
  sections.push('You have persistent memory across conversations. Use it to learn about the user over time.');
  sections.push('');
  for (const t of memoryTools) {
    sections.push('```json', formatToolJson(t), '```', '');
  }
  sections.push(MEMORY_GUIDELINES);

  // Tasks
  sections.push('');
  sections.push('## Task & Scheduling Tools');
  sections.push('You can create one-off or recurring tasks. Tasks run in the background via a queue.');
  sections.push('');
  for (const t of taskTools) {
    sections.push('```json', formatToolJson(t), '```', '');
  }
  sections.push(TASK_GUIDELINES);

  // Skills
  sections.push('');
  sections.push('## Skill Activation');
  sections.push('Skills extend your capabilities with additional tools (terminal, browser, search, etc.).');
  sections.push('');
  for (const t of skillTools) {
    sections.push('```json', formatToolJson(t), '```', '');
  }
  sections.push(SKILL_GUIDELINES);

  return sections.join('\n');
}

@Injectable()
export class PromptService {
  private readonly internalToolsSection: string;
  private readonly formattingRules: string;

  constructor(
    private readonly skillRegistry: SkillRegistryService,
    private readonly config: ConfigService,
  ) {
    // Built once at startup — tool definitions don't change at runtime
    this.internalToolsSection = buildInternalToolsSection();
    this.formattingRules = this.buildFormattingRules();
  }

  private buildFormattingRules(): string {
    const telegramEnabled = this.config.get('channel.telegram.enabled', false);
    const whatsappEnabled = this.config.get('channel.whatsapp.enabled', false);

    // Primary channel determines formatting rules
    if (telegramEnabled) return FORMAT_TELEGRAM;
    if (whatsappEnabled) return FORMAT_WHATSAPP;
    return FORMAT_PLAIN;
  }

  build(
    botPersona: string,
    userProfile: string,
    memoryContext: string,
    activatedSkills: Set<string>,
  ): string {
    const parts: string[] = [];

    // 1. Bot persona
    if (botPersona) parts.push(botPersona);

    // 2. User profile
    if (userProfile) parts.push(`# User Profile\n${userProfile}`);

    // 3. Instructions + internal tools
    parts.push(`# Instructions\n\n${GENERAL_BEHAVIOR}\n\n${this.formattingRules}\n\n${COMMON_WORKFLOWS}\n\n${this.internalToolsSection}`);

    // 4. Skills — progressive disclosure
    const activeSkills = this.skillRegistry.getActiveSkills();
    if (activeSkills.length) {
      const skillParts: string[] = [];

      // Level 1: one-line summaries for non-activated skills
      const summaryLines: string[] = [];
      for (const skill of activeSkills) {
        if (!activatedSkills.has(skill.name)) {
          const label = this.skillRegistry.isBuiltin(skill.name) ? 'builtin' : 'custom';
          summaryLines.push(`- ${skill.name} (${label}): ${skill.description}`);
        }
      }
      if (summaryLines.length) {
        skillParts.push(`Call activate_skill before using skill tools.\n\n${summaryLines.join('\n')}`);
      }

      // Level 2: full details for activated skills
      for (const skill of activeSkills) {
        if (!activatedSkills.has(skill.name)) continue;
        const label = this.skillRegistry.isBuiltin(skill.name) ? 'builtin' : 'custom';
        let section = `## ${skill.name} (${label})\n${skill.description}`;
        if (skill.tools.length) {
          section += '\n';
          for (const t of skill.tools) {
            section += `\n\`\`\`json\n${formatToolJson(t)}\n\`\`\`\n`;
          }
        }
        if (skill.instructions) section += `\n${skill.instructions}`;
        skillParts.push(section);
      }

      parts.push(`# Skills\n\n${skillParts.join('\n\n')}`);
    }

    // 5. Context
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const contextParts = [`Current UTC time: ${now}`];
    if (memoryContext) contextParts.push(memoryContext);
    parts.push(`# Context\n\n${contextParts.join('\n\n')}`);

    return parts.join('\n\n');
  }
}
