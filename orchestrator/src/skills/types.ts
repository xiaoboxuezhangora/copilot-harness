export type BusinessSkillStatus = 'draft' | 'active' | 'watch' | 'deprecated';

export type VendorSkillExportTarget =
  | 'anthropic-claude-skills'
  | 'github-copilot-skills'
  | 'google-adk-skills'
  | 'openai-gpt'
  | 'openai-agents-sdk'
  | 'microsoft-365-copilot';

export type SkillProtocolMaturity = 'converged' | 'converging' | 'vendor_specific';

export interface SkillProtocolAssessment {
  readonly id: string;
  readonly name: string;
  readonly maturity: SkillProtocolMaturity;
  readonly sharedProtocol: boolean;
  readonly vendors: readonly string[];
  readonly packageShape: string;
  readonly adapterStrategy: string;
  readonly sourceRefs: readonly string[];
}

export interface BusinessSkillRepositoryTarget {
  readonly repository: string;
  readonly branch: string;
  readonly module: string;
  readonly reason: string;
}

export interface BusinessSkillQualityMetrics {
  readonly hitRate: number;
  readonly correctionRate: number;
  readonly reuseCount: number;
  readonly lastEvaluatedAt: string;
}

export type SemanticAssetSource = 'jira' | 'mr_review' | 'eval' | 'agent_trace' | 'manual';
export type SemanticAssetPromotion = 'candidate' | 'accepted' | 'rejected';

export interface BusinessSkillSemanticAsset {
  readonly id: string;
  readonly source: SemanticAssetSource;
  readonly promotion: SemanticAssetPromotion;
  readonly summary: string;
  readonly evidenceRefs: readonly string[];
  readonly qualityImpact: number;
}

export interface BusinessSkillDefinition {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly status: BusinessSkillStatus;
  readonly owner: string;
  readonly description: string;
  readonly positiveTriggers: readonly string[];
  readonly negativeTriggers: readonly string[];
  readonly keywords: readonly string[];
  readonly defaultAgents: readonly string[];
  readonly defaultWorkflow: readonly string[];
  readonly repositoryTargets: readonly BusinessSkillRepositoryTarget[];
  readonly mcpAllowList: readonly string[];
  readonly requiredInputs: readonly string[];
  readonly guardrails: readonly string[];
  readonly requiredOutputs: readonly string[];
  readonly referenceFiles: readonly string[];
  readonly exportTargets: readonly VendorSkillExportTarget[];
  readonly quality: BusinessSkillQualityMetrics;
  readonly semanticAssets: readonly BusinessSkillSemanticAsset[];
}

export interface BusinessSkillMatch {
  readonly skillId: string;
  readonly score: number;
  readonly matchedKeywords: readonly string[];
  readonly repositoryTargets: readonly BusinessSkillRepositoryTarget[];
}

export interface SkillQualityImprovement {
  readonly skillId: string;
  readonly priority: 'high' | 'medium' | 'low';
  readonly title: string;
  readonly rationale: string;
  readonly sourceAssetIds: readonly string[];
}
