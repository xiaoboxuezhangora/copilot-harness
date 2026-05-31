import type {
  BusinessSkillDefinition,
  BusinessSkillMatch,
  SkillProtocolAssessment
} from './types.js';

export const ANGULAR17_BUSINESS_SKILL_ID = 'angular17-upgrade-regression-handler';

export const skillProtocolAssessments = [
  {
    id: 'agent-skills',
    name: 'Agent Skills / SKILL.md',
    maturity: 'converging',
    sharedProtocol: true,
    vendors: ['Anthropic Claude Skills', 'GitHub Copilot agent skills', 'Google ADK Skills'],
    packageShape: 'Folder with SKILL.md frontmatter, instructions, references, scripts, assets.',
    adapterStrategy:
      'Use as primary export format when a target platform accepts SKILL.md-style folders.',
    sourceRefs: [
      'https://claude.com/docs/skills/overview',
      'https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/create-skills',
      'https://adk.dev/skills/'
    ]
  },
  {
    id: 'mcp',
    name: 'Model Context Protocol',
    maturity: 'converged',
    sharedProtocol: true,
    vendors: ['Anthropic', 'OpenAI Apps SDK', 'GitHub Copilot', 'Google ADK'],
    packageShape: 'Tool, resource, prompt, and server protocol; not a business Skill package.',
    adapterStrategy:
      'Keep MCP as capability boundary referenced by skills, not as the skill definition itself.',
    sourceRefs: [
      'https://modelcontextprotocol.io/specification',
      'https://developers.openai.com/apps-sdk/'
    ]
  },
  {
    id: 'openai-gpt-agents',
    name: 'OpenAI GPT / Agents configuration',
    maturity: 'vendor_specific',
    sharedProtocol: false,
    vendors: ['OpenAI GPTs', 'OpenAI Agents SDK', 'OpenAI Apps SDK'],
    packageShape: 'Instructions, knowledge files, tools/actions, guardrails, and app components.',
    adapterStrategy:
      'Generate instructions, knowledge bundle, tool descriptors, and guardrail notes from the internal model.',
    sourceRefs: [
      'https://help.openai.com/en/articles/8843948-knowledge-in-gpts',
      'https://openai.github.io/openai-agents-js/'
    ]
  },
  {
    id: 'microsoft-declarative-agent',
    name: 'Microsoft 365 Copilot declarative agent',
    maturity: 'vendor_specific',
    sharedProtocol: false,
    vendors: ['Microsoft 365 Copilot', 'Microsoft Copilot Studio'],
    packageShape: 'Declarative agent manifest with instructions, knowledge, actions, and capabilities.',
    adapterStrategy:
      'Generate manifest fields and split long references into knowledge/action packages.',
    sourceRefs: [
      'https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/overview-declarative-agent'
    ]
  },
  {
    id: 'gemini-gems',
    name: 'Gemini Gems / app-level agents',
    maturity: 'vendor_specific',
    sharedProtocol: false,
    vendors: ['Google Gemini Gems'],
    packageShape: 'UI-managed instructions and knowledge rather than a portable skill folder.',
    adapterStrategy:
      'Export concise instructions, examples, and curated knowledge assets from the internal model.',
    sourceRefs: ['https://support.google.com/gemini/answer/15236321']
  }
] as const satisfies readonly SkillProtocolAssessment[];

export const businessSkillCatalog = [
  {
    id: ANGULAR17_BUSINESS_SKILL_ID,
    name: 'Angular17 升级回归分析',
    version: '1.1.0',
    status: 'active',
    owner: 'copilot-harness',
    description:
      '处理 Angular 17 升级后的 UI、交互、DOM、ng-zorro、图标颜色和动态表单回归，输出可验证修复方案。',
    positiveTriggers: [
      'Jira 标题或描述包含 Angular17、升级后、升级17。',
      '症状属于空白页、布局变形、弹窗/抽屉异常、表格固定头、dynamic-form 或图标色差。',
      '问题发生在已能启动的前端工程中，主要表现为渲染、样式、时序或交互回归。'
    ],
    negativeTriggers: [
      '主问题是依赖安装、编译启动失败或运行环境不可用。',
      '根因明确来自后端数据、权限、接口契约或医院环境配置。',
      '任务是新功能开发、主动视觉巡检或通用 Angular 组件交付。'
    ],
    keywords: [
      'angular17',
      'angular 17',
      '升级后',
      '升级17',
      '空白页',
      '图标色差',
      '布局变形',
      'dynamic-form',
      'ng-zorro',
      'nz-icon',
      'twotone',
      '弹窗',
      '固定表头'
    ],
    defaultAgents: ['需求澄清', '影响面分析师', 'Angular 专家', '代码检索器', '方案架构师'],
    defaultWorkflow: ['需求澄清', '影响面分析', 'Angular17 分析', '代码检索', '方案生成'],
    repositoryTargets: [
      {
        repository: 'apmis/odcbs/odcbs-frontend',
        branch: 'develop_to_angular17',
        module: 'odcbs-frontend',
        reason: 'Angular17 升级回归默认检索目标'
      }
    ],
    mcpAllowList: ['JiraReader', 'GitLabReader', 'CodeRetrieval', 'PolicyMCP'],
    requiredInputs: ['issue_id 或 Jira 描述', '页面/模块', '实际表现', '期望表现', '截图或复现步骤'],
    guardrails: [
      '历史案例只能作为参考证据，不能替代当前复现或代码证据。',
      '先确认版本、DOM、时序和共享层，再考虑页面级样式补丁。',
      '缺少截图和基本描述时阻塞实施，仅允许 consult-only triage。'
    ],
    requiredOutputs: [
      'Issue summary',
      'L0/L1 status',
      'Baseline verdict',
      'Fix-layer recommendation',
      'Implementation task card',
      'Validation checklist'
    ],
    referenceFiles: [
      'skills/.github/skills/angular17-upgrade-regression-handler/SKILL.md',
      'skills/.github/skills/angular17-upgrade-regression-handler/reference/case-index.md'
    ],
    exportTargets: [
      'anthropic-claude-skills',
      'github-copilot-skills',
      'google-adk-skills',
      'openai-gpt',
      'openai-agents-sdk',
      'microsoft-365-copilot'
    ],
    quality: {
      hitRate: 0.86,
      correctionRate: 0.18,
      reuseCount: 14,
      lastEvaluatedAt: '2026-05-28'
    },
    semanticAssets: [
      {
        id: 'angular17-svg-color-candidate',
        source: 'mr_review',
        promotion: 'candidate',
        summary:
          '图标色差类问题需要额外采集 svg/path fill、stroke 和 computed color，避免只看 .anticon。',
        evidenceRefs: ['gitlab:apmis/odcbs/odcbs-frontend#mr-review:angular17-icon-color'],
        qualityImpact: 0.12
      },
      {
        id: 'angular17-overlay-timing-accepted',
        source: 'agent_trace',
        promotion: 'accepted',
        summary:
          'nz-modal、nz-drawer、nz-popover 内表格 scroll.y 应在内容挂载后校验 .ant-table-body 高度。',
        evidenceRefs: ['audit:agent-trace/angular17-overlay-table-scroll'],
        qualityImpact: 0.16
      }
    ]
  },
  {
    id: 'blood-transfusion',
    name: '输血闭环业务分析',
    version: '1.0.0',
    status: 'active',
    owner: 'copilot-harness',
    description:
      '处理 APMIS 输血链路、备改输、BIZ857、平台推送、场景码和 ODCBS/ODBIP 边界分析。',
    positiveTriggers: ['Jira 涉及输血、血袋、取血、备改输、双人核对、配血或输血反应。'],
    negativeTriggers: ['非输血闭环业务、通用 SSO、纯前端样式或基础设施问题。'],
    keywords: ['输血', '血袋', '取血', '备改输', '双人核对', '配血', 'biz857', 'blood transfusion'],
    defaultAgents: ['需求澄清', '业务分析师', '代码检索器', '方案架构师'],
    defaultWorkflow: ['需求澄清', '业务链路定位', '代码检索', '方案生成'],
    repositoryTargets: [
      {
        repository: 'apmis/odcbs/odcbs-backend',
        branch: 'develop',
        module: 'transfusion-chain',
        reason: '输血闭环默认后端检索目标'
      }
    ],
    mcpAllowList: ['JiraReader', 'GitLabReader', 'CodeRetrieval'],
    requiredInputs: ['Jira 描述', '业务场景', '患者/医嘱/输血状态脱敏事实'],
    guardrails: ['病案与收费原文禁止进入 LLM prompt，事实发现走 MCP。'],
    requiredOutputs: ['业务链路结论', '影响模块', '风险与验证清单'],
    referenceFiles: ['skills/.github/skills/blood-transfusion/SKILL.md'],
    exportTargets: ['github-copilot-skills', 'openai-gpt', 'microsoft-365-copilot'],
    quality: {
      hitRate: 0.79,
      correctionRate: 0.21,
      reuseCount: 9,
      lastEvaluatedAt: '2026-05-28'
    },
    semanticAssets: [
      {
        id: 'blood-transfusion-biz857-accepted',
        source: 'manual',
        promotion: 'accepted',
        summary: 'BIZ857 和平台推送问题优先按异步消息链路定位。',
        evidenceRefs: ['skills/.github/skills/blood-transfusion/references/transfusion-biz857.md'],
        qualityImpact: 0.1
      }
    ]
  },
  {
    id: 'angular-delivery',
    name: 'Angular17 通用交付',
    version: '1.0.0',
    status: 'watch',
    owner: 'copilot-harness',
    description: '处理 Angular 17 组件、路由、状态、表单、ng-zorro 表格和共享 UI 行为交付质量。',
    positiveTriggers: ['Angular 17 新功能实现、组件评审、ng-zorro table/overlay/shared UI 交付。'],
    negativeTriggers: ['升级后已知回归排查应优先使用 Angular17 升级回归分析。'],
    keywords: ['angular', 'ng-zorro', '组件', '路由', '表单', '表格', 'overlay'],
    defaultAgents: ['Angular 专家', '代码评审员', '测试工程师'],
    defaultWorkflow: ['实现约束检查', '代码检索', '方案生成', 'MR Review'],
    repositoryTargets: [
      {
        repository: 'apmis/odcbs/odcbs-frontend',
        branch: 'develop',
        module: 'odcbs-frontend',
        reason: '通用前端交付默认检索目标'
      }
    ],
    mcpAllowList: ['GitLabReader', 'CodeRetrieval', 'PolicyMCP'],
    requiredInputs: ['需求目标', '目标组件或路径', '交互/验证规则'],
    guardrails: ['不新增第二套状态模式，优先复用现有共享组件。'],
    requiredOutputs: ['实现建议', '验证清单', 'Review reminders'],
    referenceFiles: ['skills/.github/skills/angular-delivery/SKILL.md'],
    exportTargets: ['github-copilot-skills', 'google-adk-skills', 'openai-agents-sdk'],
    quality: {
      hitRate: 0.73,
      correctionRate: 0.24,
      reuseCount: 7,
      lastEvaluatedAt: '2026-05-28'
    },
    semanticAssets: [
      {
        id: 'angular-delivery-table-width-candidate',
        source: 'eval',
        promotion: 'candidate',
        summary: 'editable table 应把 header/body/control width 统一到同一列配置源。',
        evidenceRefs: ['eval:angular-delivery-table-width'],
        qualityImpact: 0.08
      }
    ]
  }
] as const satisfies readonly BusinessSkillDefinition[];

export function findBusinessSkill(skillId: string): BusinessSkillDefinition | null {
  return businessSkillCatalog.find((skill) => skill.id === skillId) ?? null;
}

export function resolveBusinessSkillMatches(text: string): readonly BusinessSkillMatch[] {
  const normalized = text.toLowerCase();

  return businessSkillCatalog
    .map((skill) => {
      const matchedKeywords = skill.keywords.filter((keyword) =>
        normalized.includes(keyword.toLowerCase())
      );

      return {
        skillId: skill.id,
        score: matchedKeywords.length,
        matchedKeywords,
        repositoryTargets: skill.repositoryTargets
      };
    })
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score);
}

export function shouldLoadAngular17Skill(taskDescription: string): boolean {
  return resolveBusinessSkillMatches(taskDescription).some(
    (match) => match.skillId === ANGULAR17_BUSINESS_SKILL_ID && match.score > 0
  );
}

export function isSkillProtocolClosed(): boolean {
  return skillProtocolAssessments.every(
    (assessment) => assessment.sharedProtocol && assessment.maturity === 'converged'
  );
}
