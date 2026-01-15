export enum ViewState {
  ASSISTANT = "ASSISTANT",
  PROMPT_LIBRARY = "PROMPT_LIBRARY",
  ACTIONS = "ACTIONS",
  PLAYBOOKS = "PLAYBOOKS",
  HISTORY = "HISTORY",
  DOCUMENT = "DOCUMENT",
}

export enum ActionType {
  FIELD_TEMPLATE = "FIELD_TEMPLATE",
  ANONYMIZE = "ANONYMIZE",
  IMPROVE = "IMPROVE",
  TRANSLATE = "TRANSLATE",
}

export interface Playbook {
  id: string;
  name: string;
  description: string;
  rules: string[];
}

export interface RedlineSuggestion {
  originalText: string;
  suggestedText: string;
  reason: string;
  severity: "high" | "medium" | "low";
}

export interface DocumentContext {
  content: string;
  selection: string;
}

export interface ImprovementResult {
  originalText: string;
  rewrittenText: string;
  explanation: string;
  diffMarkup: string; // Text with <remove>...</remove> and <add>...</add> tags
}

/**
 * Agent interface
 * Explicitly requested by the user (plan): extended agent definition used to persist and drive analysis.
 * Reasoning: We store not just rules, but optional systemPrompt/model/tools so future analyzers can be agent-aware.
 */
export interface Agent {
  id: string;
  name: string;
  description?: string;
  rules: string[];
  systemPrompt?: string;
  model?: string;
  // Tools are stored as an arbitrary JSON array. We intentionally type as any[]
  // to allow flexible future shapes (user-requested feature).
  tools?: any[];
}
