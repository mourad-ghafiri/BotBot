import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ToolDefinition } from '../llm/llm.types';

export interface ParsedSkill {
  name: string;
  description: string;
  tools: ToolDefinition[];
  instructions: string;
  metadata: Record<string, any>;
}

@Injectable()
export class SkillLoaderService {
  private readonly logger = new Logger(SkillLoaderService.name);

  parseSkillDir(dirPath: string): ParsedSkill {
    const dirName = path.basename(dirPath);
    const toolsJsonPath = path.join(dirPath, 'tools.json');
    const skillMdPath = path.join(dirPath, 'SKILL.md');

    // New format: tools.json + SKILL.md
    if (fs.existsSync(toolsJsonPath)) {
      return this.parseNewFormat(dirPath, dirName, toolsJsonPath, skillMdPath);
    }

    // Legacy fallback: YAML frontmatter in SKILL.md
    if (fs.existsSync(skillMdPath)) {
      this.logger.debug(`No tools.json for ${dirName}, falling back to legacy YAML frontmatter`);
      return this.parseLegacyFormat(skillMdPath, dirName);
    }

    return { name: dirName, description: '', tools: [], instructions: '', metadata: {} };
  }

  private parseNewFormat(dirPath: string, dirName: string, toolsJsonPath: string, skillMdPath: string): ParsedSkill {
    let name = dirName;
    let description = '';
    let tools: ToolDefinition[] = [];
    let metadata: Record<string, any> = {};

    try {
      const raw = JSON.parse(fs.readFileSync(toolsJsonPath, 'utf-8'));
      name = raw.name || dirName;
      description = raw.description || '';
      metadata = raw.metadata || {};

      for (const t of raw.tools || []) {
        if (t && typeof t === 'object' && t.name) {
          tools.push({
            name: t.name,
            description: t.description || '',
            input_schema: t.input_schema || { type: 'object', properties: {} },
          });
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to parse tools.json in ${dirPath}: ${err}`);
    }

    let instructions = '';
    if (fs.existsSync(skillMdPath)) {
      instructions = fs.readFileSync(skillMdPath, 'utf-8').trim();
    }

    return { name, description, tools, instructions, metadata };
  }

  private parseLegacyFormat(filePath: string, dirName: string): ParsedSkill {
    const text = fs.readFileSync(filePath, 'utf-8');

    if (!text.startsWith('---')) {
      return { name: dirName, description: '', tools: [], instructions: text, metadata: {} };
    }

    const parts = text.split('---');
    if (parts.length < 3) {
      return { name: dirName, description: '', tools: [], instructions: text, metadata: {} };
    }

    const frontmatter = (yaml.load(parts[1]) as Record<string, any>) || {};
    const body = parts.slice(2).join('---').trim();

    const name = frontmatter.name || dirName;
    const description = frontmatter.description || '';

    const rawTools = frontmatter.tools || [];
    const tools: ToolDefinition[] = [];
    for (const t of rawTools) {
      if (t && typeof t === 'object' && t.name) {
        tools.push({
          name: t.name,
          description: t.description || '',
          input_schema: t.input_schema || { type: 'object', properties: {} },
        });
      }
    }

    return {
      name,
      description,
      tools,
      instructions: body,
      metadata: frontmatter.metadata || {},
    };
  }
}
