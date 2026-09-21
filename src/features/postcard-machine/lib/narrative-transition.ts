export type NarrativeTransitionPhase = "entering" | "exiting" | "settled";

export type NarrativeTransitionState = {
  displayed: number;
  requested: number;
  phase: NarrativeTransitionPhase;
};

type NarrativeTransitionAction =
  | { immediate?: boolean; stage: number; type: "request" }
  | { type: "finish" };

export const PRESENTATION_TRANSITION_FALLBACK_MS = 300;

export function createNarrativeTransition(stage: number): NarrativeTransitionState {
  return { displayed: stage, requested: stage, phase: "settled" };
}

export function narrativeTransitionReducer(
  state: NarrativeTransitionState,
  action: NarrativeTransitionAction,
): NarrativeTransitionState {
  if (action.type === "request") {
    if (action.immediate) return createNarrativeTransition(action.stage);
    if (action.stage === state.requested) return state;
    if (state.phase !== "settled") return { ...state, requested: action.stage };
    if (action.stage === state.displayed) return { ...state, requested: action.stage };
    return { ...state, requested: action.stage, phase: "exiting" };
  }

  if (state.phase === "exiting") {
    return { displayed: state.requested, requested: state.requested, phase: "entering" };
  }
  if (state.phase === "entering") {
    if (state.displayed === state.requested) return { ...state, phase: "settled" };
    return { ...state, phase: "exiting" };
  }
  return state;
}
