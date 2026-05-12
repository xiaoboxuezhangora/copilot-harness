import type { EvidencePack, RuntimeModel, TurnState } from '../runtime/index.js';

export type AgentRole = 'planner' | 'implementer' | 'critic' | 'reviewer';

export type FleetWorktreeMode = 'mock' | 'real_disabled';

export type CriticVerdict = 'accept' | 'revise' | 'reject';

export const W10_FLEET_SESSION_SCHEMA = 'phase-1c-w10-fleet-session@1';

export const W10_FLEET_PROMPT_VERSION = 'fleet-mock-control-plane@0.1';

export interface AgentDefinition {
  readonly id: string;
  readonly role: AgentRole;
  readonly model: RuntimeModel;
  readonly promptPath: string;
  readonly allowedTools: readonly string[];
  readonly worktreeMode: FleetWorktreeMode;
}

export interface FleetPlanStep {
  readonly stepId: string;
  readonly title: string;
  readonly description: string;
  readonly filesTouched: readonly string[];
  readonly acceptance: readonly string[];
}

export interface FleetPlan {
  readonly fleetSessionId: string;
  readonly parentTaskId: string;
  readonly taskId: string;
  readonly planner: AgentDefinition;
  readonly steps: readonly FleetPlanStep[];
  readonly acceptance: readonly string[];
  readonly evidencePack: EvidencePack;
}

export interface FleetCandidateSelfTest {
  readonly command: string;
  readonly passed: boolean;
  readonly summary: string;
}

export interface FleetCandidate {
  readonly fleetSessionId: string;
  readonly parentTaskId: string;
  readonly candidateId: string;
  readonly stepId: string;
  readonly filesTouched: readonly string[];
  readonly anonymousDiff: string;
  readonly selfTest: FleetCandidateSelfTest;
  readonly acceptance: readonly string[];
  readonly turnState: TurnState;
  readonly policyDecision: 'allow' | 'deny';
  readonly blockedReason?: string;
  readonly evidencePack: EvidencePack;
}

export interface BlindCriticInput {
  readonly candidateId: string;
  readonly anonymousDiff: string;
  readonly selfTest: FleetCandidateSelfTest;
  readonly acceptance: readonly string[];
}

export interface BlindCriticScore {
  readonly fleetSessionId: string;
  readonly parentTaskId: string;
  readonly candidateId: string;
  readonly score: number;
  readonly verdict: CriticVerdict;
  readonly strengths: readonly string[];
  readonly risks: readonly string[];
  readonly blindInput: BlindCriticInput;
  readonly evidencePack: EvidencePack;
}

export interface ReviewerDraft {
  readonly fleetSessionId: string;
  readonly parentTaskId: string;
  readonly artifactId: string;
  readonly title: string;
  readonly body: string;
  readonly selectedCandidateId: string;
  readonly isDraft: true;
  readonly pushed: false;
  readonly mergeRequestCreated: false;
  readonly policyDecision: 'deny' | 'allow' | 'escalate';
  readonly approvalRequired: 'L2';
  readonly worktreeMode: 'real_disabled';
  readonly evidencePack: EvidencePack;
}

export interface FleetBlockedPartialResult {
  readonly summary: string;
  readonly completedSteps: readonly string[];
  readonly blockedReason: string;
}

export interface FleetSession {
  readonly schemaVersion: typeof W10_FLEET_SESSION_SCHEMA;
  readonly fleetSessionId: string;
  readonly parentTaskId: string;
  readonly taskId: string;
  readonly turnState: TurnState;
  readonly worktreeMode: 'mock';
  readonly realFanout: 'real_disabled';
  readonly realMergeRequest: 'real_disabled';
  readonly plan?: FleetPlan;
  readonly candidates: readonly FleetCandidate[];
  readonly criticScores: readonly BlindCriticScore[];
  readonly reviewerDraft?: ReviewerDraft;
  readonly evidencePack: EvidencePack;
  readonly auditTraceId: string;
  readonly blockedPartialResult?: FleetBlockedPartialResult;
}

export interface MockFleetCandidateDraft {
  readonly stepId: string;
  readonly filesTouched: readonly string[];
  readonly anonymousDiff: string;
  readonly selfTest: FleetCandidateSelfTest;
}

export interface FleetCoordinatorInput {
  readonly taskId: string;
  readonly parentTaskId?: string;
  readonly prompt: string;
  readonly intent: string;
  readonly allowedFiles: readonly string[];
  readonly acceptance?: readonly string[];
  readonly fanout?: number;
}
