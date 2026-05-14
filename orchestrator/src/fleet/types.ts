import type { EvidencePack, RuntimeModel, TurnState } from '../runtime/index.js';

export type AgentRole = 'planner' | 'implementer' | 'critic' | 'reviewer';

export type FleetWorktreeMode = 'mock' | 'real_disabled';

export type CriticVerdict = 'accept' | 'revise' | 'reject';

export const W10_FLEET_SESSION_SCHEMA = 'phase-1c-w10-fleet-session@1';

export const W10_FLEET_PROMPT_VERSION = 'fleet-mock-control-plane@0.1';

export const W12_ARENA_SESSION_SCHEMA = 'phase-2-w12-arena-session@1';

export const W12_ARENA_EVAL_SEED_SCHEMA = 'phase-2-w12-arena-eval-seed-artifact@1';

export const W12_ARENA_ARCHIVE_SCHEMA = 'phase-2-w12-arena-archive@1';

export type ArenaScorerMode = 'mock';

export type ArenaRealScorerStatus = '未接入';

export type ArenaArchiveStatus = 'winner' | 'loser';

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
  readonly anonymousDiff: string;
  readonly selfTest: FleetCandidateSelfTest;
  readonly acceptance: readonly string[];
}

export interface ArenaScoreDimensions {
  readonly correctness: number;
  readonly style: number;
  readonly testCoverage: number;
  readonly diffMinimality: number;
}

export interface ArenaConsistency {
  readonly candidateId: string;
  readonly firstRunId: string;
  readonly secondRunId: string;
  readonly delta: number;
  readonly threshold: 0.5;
  readonly passed: boolean;
}

export interface ArenaCriticRun {
  readonly runId: string;
  readonly fleetSessionId: string;
  readonly parentTaskId: string;
  readonly candidateId: string;
  readonly runIndex: 1 | 2;
  readonly scorerMode: ArenaScorerMode;
  readonly realScorer: ArenaRealScorerStatus;
  readonly dimensions: ArenaScoreDimensions;
  readonly overallScore: number;
  readonly verdict: CriticVerdict;
  readonly blindInput: BlindCriticInput;
  readonly evidencePack: EvidencePack;
}

export interface ArenaCandidateScore {
  readonly candidateId: string;
  readonly dimensions: ArenaScoreDimensions;
  readonly overallScore: number;
  readonly consistency: ArenaConsistency;
  readonly criticRunIds: readonly string[];
}

export interface ArenaWinner {
  readonly candidateId: string;
  readonly dimensions: ArenaScoreDimensions;
  readonly overallScore: number;
  readonly consistencyDelta: number;
  readonly consistencyPassed: boolean;
  readonly criticRunIds: readonly string[];
}

export interface ArenaSession {
  readonly schemaVersion: typeof W12_ARENA_SESSION_SCHEMA;
  readonly fleetSessionId: string;
  readonly parentTaskId: string;
  readonly taskId: string;
  readonly scorerMode: ArenaScorerMode;
  readonly realScorer: ArenaRealScorerStatus;
  readonly candidateCount: number;
  readonly consistencyThreshold: 0.5;
  readonly criticRuns: readonly ArenaCriticRun[];
  readonly candidateScores: readonly ArenaCandidateScore[];
  readonly winner: ArenaWinner;
  readonly archivePath: string;
  readonly evidencePack: EvidencePack;
}

export interface ArenaEvalSeedRecord {
  readonly seedId: string;
  readonly sessionId: string;
  readonly winnerCandidateId: string;
  readonly loserCandidateId: string;
  readonly weekKey: string;
  readonly sourceRef: string;
  readonly status: 'pending_review';
}

export interface ArenaEvalSeedCandidateSnapshot {
  readonly candidateId: string;
  readonly dimensions: ArenaScoreDimensions;
  readonly overallScore: number;
  readonly consistencyDelta: number;
}

export interface ArenaEvalSeedSample extends ArenaEvalSeedRecord {
  readonly archivePath: string;
  readonly winner: ArenaEvalSeedCandidateSnapshot;
  readonly loser: ArenaEvalSeedCandidateSnapshot;
}

export interface ArenaEvalSeedArtifact {
  readonly schemaVersion: typeof W12_ARENA_EVAL_SEED_SCHEMA;
  readonly generatedAt: string;
  readonly weekKey: string;
  readonly status: 'pending_review';
  readonly autoMerge: false;
  readonly minSamples: number;
  readonly sampleCount: number;
  readonly samples: readonly ArenaEvalSeedSample[];
}

export interface ArenaArchivedCandidate {
  readonly candidateId: string;
  readonly archiveStatus: ArenaArchiveStatus;
  readonly dimensions: ArenaScoreDimensions;
  readonly overallScore: number;
  readonly consistencyDelta: number;
  readonly evidenceSourceRefs: readonly string[];
}

export interface ArenaArchiveArtifact {
  readonly schemaVersion: typeof W12_ARENA_ARCHIVE_SCHEMA;
  readonly generatedAt: string;
  readonly status: 'pending_review';
  readonly autoMerge: false;
  readonly fleetSessionId: string;
  readonly archivePath: string;
  readonly winner: ArenaWinner;
  readonly candidates: readonly ArenaArchivedCandidate[];
}

export interface BlindCriticScore {
  readonly fleetSessionId: string;
  readonly parentTaskId: string;
  readonly candidateId: string;
  readonly score: number;
  readonly verdict: CriticVerdict;
  readonly dimensions: ArenaScoreDimensions;
  readonly consistencyDelta: number;
  readonly consistencyPassed: boolean;
  readonly criticRunIds: readonly string[];
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
  readonly arena?: ArenaSession;
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
