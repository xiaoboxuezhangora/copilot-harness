export interface ContextFragment {
  readonly source: string;
  readonly content: string;
  readonly sensitivity: 'public' | 'restricted';
}

export interface AssembledContext {
  readonly fragments: readonly ContextFragment[];
  readonly redactionApplied: boolean;
}

export interface ContextAssembler {
  assemble(_fragments: readonly ContextFragment[]): AssembledContext;
}
