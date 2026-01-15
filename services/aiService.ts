import {
  RedlineSuggestion,
  Playbook,
  ImprovementResult,
  Agent,
} from "../types";
import {
  sanitizePrompt,
  sanitizeInput,
  INPUT_LIMITS,
  validateRequired,
} from "../utils/validation";
import { enqueueAndStart, waitForCompletion } from "./gptWorkerService";
import { supabase, isSupabaseConfigured } from "./supabaseClient";

const FAST_MODEL = "gpt-4o-mini";
const SMART_MODEL = "gpt-4o";

/**
 * Explicitly added for the user's request: structure for template fill + summary.
 * Reasoning: The UI needs both the completed document and a concise change list
 * to render the result overlay that mirrors the provided screenshot.
 */
export interface TemplateChangeItem {
  /** High-level category for basic iconography or grouping */
  type: "added" | "updated" | "removed";
  /** Short, user-facing title such as "Removed placeholder text" */
  title: string;
  /** The actual filled value (optional, shown when item is expanded) */
  value?: string;
}

export interface FillTemplateWithSummaryResult {
  /** The completed document text after placeholder filling */
  filledDocument: string;
  /** Concise list of changes suitable for direct display in the UI */
  changes: TemplateChangeItem[];
}

const WORKER_WAIT_TIMEOUT_MS = parseInt(
  (import.meta as any).env?.VITE_LLM_WORKER_WAIT_TIMEOUT_MS || "60000",
  10
);
const WORKER_POLL_INTERVAL_MS = 1000;

/**
 * Helper to run the Cloud Run generic worker with the provided chunks and prompt,
 * then wait for completion and return the output chunks.
 *
 * Added per user plan: we now route ALL AI calls to the Cloud Run endpoint and
 * avoid Supabase Edge Functions entirely for GPT work. The reasoning is to
 * prevent Edge Function timeouts/quotas and always include the full document text.
 */
async function runWorkerAndGetOutputs(
  inputChunks: string[],
  gptPrompt: string,
  meta: Record<string, any> = {}
): Promise<any[]> {
  const taskId = await enqueueAndStart(inputChunks, gptPrompt, meta);
  const finalRow = await waitForCompletion(taskId, {
    timeoutMs: WORKER_WAIT_TIMEOUT_MS,
    intervalMs: WORKER_POLL_INTERVAL_MS,
  });
  return (finalRow?.output_chunks || []) as any[];
}

export const draftContent = async (
  prompt: string,
  context: string
): Promise<string> => {
  // Validate and sanitize inputs
  const sanitizedPrompt = validateRequired(
    sanitizePrompt(prompt, INPUT_LIMITS.CHAT_MESSAGE),
    "Prompt"
  );
  const sanitizedContext = sanitizeInput(
    context,
    INPUT_LIMITS.DOCUMENT_CONTENT
  );

  try {
    // Per user plan: always route to Cloud Run worker and include the FULL document content.
    const gptPrompt =
      `You are "Nora", an expert AI assistant for Notary Publics and Legal Professionals.\n` +
      `Context:\n<content_chunk>\n\n` +
      `Task: Draft a legal clause, affidavit section, or notary certificate based on the user request: ${sanitizedPrompt}\n` +
      `Tone: Professional, precise, and legally sound.\n` +
      `Output: ONLY the drafted text, no conversational filler.`;

    const outputs = await runWorkerAndGetOutputs(
      [sanitizedContext],
      gptPrompt,
      {
        taskType: "draft",
        model: FAST_MODEL,
        promptLength: sanitizedPrompt.length,
        contextChars: sanitizedContext.length,
      }
    );
    const text = outputs
      .map((o) => (typeof o === "string" ? o : JSON.stringify(o)))
      .join("\n\n");
    return text || "";
  } catch (error) {
    console.error("Drafting error:", error);
    throw error;
  }
};

export const runPlaybookAnalysis = async (
  content: string,
  playbook: Playbook
): Promise<RedlineSuggestion[]> => {
  console.log("[aiService] runPlaybookAnalysis called");

  // Validate input
  const sanitizedContent = validateRequired(
    sanitizeInput(content, INPUT_LIMITS.DOCUMENT_CONTENT),
    "Content"
  );

  // Validate rules exist
  if (!playbook.rules || playbook.rules.length === 0) {
    console.error("Playbook analysis error: No rules provided");
    return [];
  }

  // Check if Supabase is configured
  if (!isSupabaseConfigured || !supabase) {
    console.error("Playbook analysis error: Supabase not configured");
    return [];
  }

  try {
    // User request: Route through Edge Function → nora-ai backend
    console.log("[aiService] runPlaybookAnalysis: Invoking Edge Function...");
    const { data, error } = await supabase.functions.invoke(
      "playbook-analysis",
      {
        body: {
          content: sanitizedContent,
          rules: playbook.rules,
          system_prompt: null, // Playbooks don't have custom system prompts
        },
      }
    );

    if (error) {
      console.error("Playbook analysis Edge Function error:", error);
      return [];
    }

    if (data?.error) {
      console.error(
        "Playbook analysis Edge Function returned error:",
        data.error
      );
      return [];
    }

    // Return suggestions array, validating shape
    const suggestions = data?.suggestions || [];
    return suggestions.filter(
      (s: any) =>
        s &&
        typeof s.originalText === "string" &&
        typeof s.suggestedText === "string" &&
        typeof s.reason === "string" &&
        typeof s.severity === "string"
    ) as RedlineSuggestion[];
  } catch (error) {
    console.error("Playbook analysis error:", error);
    return [];
  }
};

/**
 * runAgentAnalysis
 * User request: Migrate from legacy Cloud Run worker to nora-ai backend via Edge Function.
 * Agent-aware analysis that uses agent.model/systemPrompt when provided.
 */
export const runAgentAnalysis = async (
  content: string,
  agent: Agent
): Promise<RedlineSuggestion[]> => {
  console.log("[aiService] runAgentAnalysis called");

  // Validate input
  const sanitizedContent = validateRequired(
    sanitizeInput(content, INPUT_LIMITS.DOCUMENT_CONTENT),
    "Content"
  );

  // Validate rules exist
  if (!agent.rules || agent.rules.length === 0) {
    console.error("Agent analysis error: No rules provided");
    return [];
  }

  // Check if Supabase is configured
  if (!isSupabaseConfigured || !supabase) {
    console.error("Agent analysis error: Supabase not configured");
    return [];
  }

  try {
    // User request: Route through Edge Function → nora-ai backend
    console.log("[aiService] runAgentAnalysis: Invoking Edge Function...");
    const { data, error } = await supabase.functions.invoke(
      "playbook-analysis",
      {
        body: {
          content: sanitizedContent,
          rules: agent.rules,
          system_prompt: agent.systemPrompt || null,
        },
      }
    );

    if (error) {
      console.error("Playbook analysis Edge Function error:", error);
      return [];
    }

    if (data?.error) {
      console.error(
        "Playbook analysis Edge Function returned error:",
        data.error
      );
      return [];
    }

    // Return suggestions array, validating shape
    const suggestions = data?.suggestions || [];
    return suggestions.filter(
      (s: any) =>
        s &&
        typeof s.originalText === "string" &&
        typeof s.suggestedText === "string" &&
        typeof s.reason === "string" &&
        typeof s.severity === "string"
    ) as RedlineSuggestion[];
  } catch (error) {
    console.error("Agent analysis error:", error);
    return [];
  }
};

export const anonymizeContent = async (selection: string): Promise<string> => {
  console.log("[aiService] anonymizeContent called");

  // Validate and sanitize input
  const sanitizedSelection = validateRequired(
    sanitizeInput(selection, INPUT_LIMITS.SELECTION),
    "Selection"
  );

  // Check if Supabase is configured
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase not configured");
  }

  try {
    // Call the anonymize-text Edge Function which routes to nora-ai backend
    // Uses ai-assistant's two-step approach: detect terms → replace with placeholders
    console.log("[aiService] anonymizeContent: Invoking Edge Function...");
    const { data, error } = await supabase.functions.invoke("anonymize-text", {
      body: { text: sanitizedSelection },
    });

    if (error) {
      console.error("Anonymize Edge Function error:", error);
      throw new Error(error.message || "Edge function failed");
    }

    // Handle error response from edge function (HTTP 200 with error in body)
    if (data?.error) {
      console.error("Anonymize Edge Function returned error:", data.error);
      throw new Error(data.error);
    }

    if (!data?.anonymized_text) {
      throw new Error("No anonymized_text in response");
    }

    return data.anonymized_text;
  } catch (error) {
    console.error("Anonymize error:", error);
    throw error;
  }
};

export const improveWriting = async (
  selection: string
): Promise<ImprovementResult> => {
  console.log("[aiService] improveWriting called");

  // Validate and sanitize input
  const sanitizedSelection = validateRequired(
    sanitizeInput(selection, INPUT_LIMITS.SELECTION),
    "Selection"
  );

  // Check if Supabase is configured
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase not configured");
  }

  try {
    // Call the improve-writing Edge Function directly
    console.log("[aiService] improveWriting: Invoking Edge Function...");
    const { data, error } = await supabase.functions.invoke("improve-writing", {
      body: { selection: sanitizedSelection },
    });

    if (error) {
      console.error("Improve writing Edge Function error:", error);
      throw new Error(error.message || "Edge function failed");
    }

    // Handle error response from edge function (HTTP 200 with error in body)
    if (data?.error) {
      console.error(
        "Improve writing Edge Function returned error:",
        data.error
      );
      throw new Error(data.error);
    }

    if (!data?.rewrittenText) {
      throw new Error("No rewrittenText in response");
    }

    return {
      originalText: sanitizedSelection,
      rewrittenText: data.rewrittenText,
      explanation: data.explanation || "Improved text clarity",
      diffMarkup: data.diffMarkup || data.rewrittenText,
    };
  } catch (error) {
    console.error("Improve writing error:", error);
    throw error;
  }
};

export const translateDocument = async (
  content: string,
  targetLang: string = "Spanish"
): Promise<string> => {
  console.log("[aiService] translateDocument called");

  // Validate and sanitize input
  const sanitizedContent = validateRequired(
    sanitizeInput(content, INPUT_LIMITS.DOCUMENT_CONTENT),
    "Content"
  );

  // Check if Supabase is configured
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase not configured");
  }

  try {
    // User request: Route translation through Edge Function → nora-ai backend
    // This replaces the legacy Cloud Run worker approach for consistency
    console.log("[aiService] translateDocument: Invoking Edge Function...");
    const { data, error } = await supabase.functions.invoke("translate", {
      body: {
        text: sanitizedContent,
        targetLang: targetLang,
      },
    });

    if (error) {
      console.error("Translate Edge Function error:", error);
      throw new Error(error.message || "Edge function failed");
    }

    // Handle error response from edge function (HTTP 200 with error in body)
    if (data?.error) {
      console.error("Translate Edge Function returned error:", data.error);
      throw new Error(data.error);
    }

    if (!data?.translatedText) {
      throw new Error("No translatedText in response");
    }

    return data.translatedText;
  } catch (error) {
    console.error("Translation error:", error);
    throw error;
  }
};

export const fillTemplate = async (
  templateContent: string,
  referenceContent: string
): Promise<string> => {
  console.log("[aiService] fillTemplate called");

  // Validate inputs
  const sanitizedTemplate = validateRequired(
    sanitizeInput(templateContent, INPUT_LIMITS.DOCUMENT_CONTENT),
    "Template"
  );
  const sanitizedReference = validateRequired(
    sanitizeInput(referenceContent, INPUT_LIMITS.DOCUMENT_CONTENT),
    "Reference"
  );

  // Check if Supabase is configured
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase not configured");
  }

  try {
    // User request: Route fill template through Edge Function → nora-ai backend
    console.log("[aiService] fillTemplate: Invoking Edge Function...");
    const { data, error } = await supabase.functions.invoke("fill-template", {
      body: {
        template: sanitizedTemplate,
        reference: sanitizedReference,
      },
    });

    if (error) {
      console.error("Fill template Edge Function error:", error);
      throw new Error(error.message || "Edge function failed");
    }

    if (data?.error) {
      console.error("Fill template Edge Function returned error:", data.error);
      throw new Error(data.error);
    }

    if (!data?.filledDocument) {
      throw new Error("No filledDocument in response");
    }

    return data.filledDocument;
  } catch (error) {
    console.error("Fill template error:", error);
    throw error;
  }
};

/**
 * Explicitly requested by the user: AI helper that returns BOTH the filled
 * document and a concise list of change titles for the result overlay.
 *
 * User request: Route through Edge Function → nora-ai backend for consistency.
 * Supports BOTH placeholder syntaxes: [PLACEHOLDER] and {{PLACEHOLDER}}.
 */
export const fillTemplateWithSummary = async (
  templateContent: string,
  referenceContent: string
): Promise<FillTemplateWithSummaryResult> => {
  console.log("[aiService] fillTemplateWithSummary called");

  // Validate inputs
  const sanitizedTemplate = validateRequired(
    sanitizeInput(templateContent, INPUT_LIMITS.DOCUMENT_CONTENT),
    "Template"
  );
  const sanitizedReference = validateRequired(
    sanitizeInput(referenceContent, INPUT_LIMITS.DOCUMENT_CONTENT),
    "Reference"
  );

  // Check if Supabase is configured
  if (!isSupabaseConfigured || !supabase) {
    return { filledDocument: templateContent, changes: [] };
  }

  try {
    // Route fill template through Edge Function → nora-ai backend
    console.log(
      "[aiService] fillTemplateWithSummary: Invoking Edge Function..."
    );
    const { data, error } = await supabase.functions.invoke("fill-template", {
      body: {
        template: sanitizedTemplate,
        reference: sanitizedReference,
      },
    });

    if (error) {
      console.error("Fill template Edge Function error:", error);
      return { filledDocument: templateContent, changes: [] };
    }

    if (data?.error) {
      console.error("Fill template Edge Function returned error:", data.error);
      return { filledDocument: templateContent, changes: [] };
    }

    const filledDocument: string = data?.filledDocument ?? "";
    const changes: TemplateChangeItem[] = Array.isArray(data?.changes)
      ? data.changes
      : [];

    return {
      filledDocument:
        typeof filledDocument === "string" && filledDocument.length > 0
          ? filledDocument
          : templateContent,
      changes: (changes || [])
        .filter(
          (c: any) =>
            c && typeof c.title === "string" && typeof c.type === "string"
        )
        .map((c: any) => ({
          type:
            c.type === "added" || c.type === "updated" || c.type === "removed"
              ? c.type
              : "updated",
          title: c.title,
          value: typeof c.value === "string" ? c.value : undefined,
        }))
        .slice(0, 200),
    };
  } catch (error) {
    // If the server fails or JSON parsing throws, degrade gracefully.
    console.error("fillTemplateWithSummary error:", error);
    return { filledDocument: templateContent, changes: [] };
  }
};

/**
 * Extracts data from reference content to fill placeholders in the template.
 * Returns a JSON object { "placeholder": "value" } for use with docxtemplater.
 */
export const getTemplateData = async (
  templateContent: string,
  referenceContent: string
): Promise<Record<string, any>> => {
  console.log("[aiService] getTemplateData called");

  const sanitizedTemplate = validateRequired(
    sanitizeInput(templateContent, INPUT_LIMITS.DOCUMENT_CONTENT),
    "Template"
  );
  const sanitizedReference = validateRequired(
    sanitizeInput(referenceContent, INPUT_LIMITS.DOCUMENT_CONTENT),
    "Reference"
  );

  const gptPrompt =
    `You are an AI data extractor. Your task is to extract values for placeholders found in the provided Template, based on the information in the Context (Reference Document).\n` +
    `Template:\n"""\n${sanitizedTemplate}\n"""\n` +
    `Identify all placeholders (like [NAME], {{DATE}}, etc.) in the Template. ` +
    `Find their corresponding values in the Context. ` +
    `Output ONLY a valid JSON object mapping placeholder names (without brackets) to their string values. ` +
    `If a value is not found, use an empty string. ` +
    `Example output: { "NAME": "John Doe", "DATE": "2023-01-01" }`;

  try {
    const outputs = await runWorkerAndGetOutputs(
      [sanitizedReference],
      gptPrompt,
      {
        taskType: "extract_data",
        model: FAST_MODEL,
        promptLength: gptPrompt.length,
        contextChars: sanitizedReference.length,
      }
    );

    const resultText = outputs
      .map((o) => (typeof o === "string" ? o : JSON.stringify(o)))
      .join("");

    // Attempt to find JSON in the output
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    console.warn("[aiService] getTemplateData: No JSON found in response");
    return {};
  } catch (error) {
    console.error("getTemplateData error:", error);
    return {};
  }
};

/**
 * Interface for tokenized text to preserve immutable entities.
 */
interface TokenizedContent {
  text: string;
  tokens: Map<string, string>;
}

/**
 * Tokenizes text by replacing immutable entities (Links, Emails) with placeholders.
 * @param text The original text
 * @returns Object containing the tokenized text and a map of tokens to original values
 */
const tokenize = (text: string): TokenizedContent => {
  const tokens = new Map<string, string>();
  let tokenCounter = 0;

  // Regex helpers
  const replaceAndStore = (
    regex: RegExp,
    prefix: string,
    currentText: string
  ) => {
    return currentText.replace(regex, (match) => {
      const tokenKey = `__${prefix}_${tokenCounter++}__`;
      tokens.set(tokenKey, match);
      return tokenKey;
    });
  };

  // 1. Emails
  let processedText = replaceAndStore(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    "EMAIL",
    text
  );

  // 2. URLs (Simple loose match to avoid breaking everything)
  processedText = replaceAndStore(/https?:\/\/[^\s]+/g, "URL", processedText);

  return { text: processedText, tokens };
};

/**
 * Restores the original values from tokens into the translated text.
 */
const detokenize = (text: string, tokens: Map<string, string>): string => {
  let restoredText = text;
  tokens.forEach((originalValue, tokenKey) => {
    // Global replacement in case AI hallucinated duplicates
    restoredText = restoredText.split(tokenKey).join(originalValue);
  });
  return restoredText;
};

/**
 * Senior Translation Implementation: Structured, Tokenized, and Context-Aware.
 * Takes raw paragraphs, tokenizes them, sends to AI, and returns translated paragraphs.
 */
export const translateDocumentStructurally = async (
  segments: { id: number; text: string }[],
  targetLang: string = "Spanish"
): Promise<{ id: number; text: string }[]> => {
  console.log(
    "[aiService] translateDocumentStructurally called with",
    segments.length,
    "segments"
  );

  if (segments.length === 0) return [];

  // Check if Supabase is configured
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase not configured");
  }

  // 1. Tokenize all segments
  const tokenizedSegments = segments.map((seg) => {
    const { text, tokens } = tokenize(seg.text);
    return { id: seg.id, text, tokens };
  });

  // 2. Prepare Payload
  const textPayload = tokenizedSegments.map((s) => s.text);

  // 3. Batching Strategy
  const CHUNK_SIZE = 20;
  const translatedSegments: { id: number; text: string }[] = [];

  for (let i = 0; i < textPayload.length; i += CHUNK_SIZE) {
    const chunk = textPayload.slice(i, i + CHUNK_SIZE);

    // Construct Prompt / Guidelines
    // Switch to Delimiter-Separated Values for robustness against JSON syntax errors (quotes/escaping).
    const userPrompt = JSON.stringify(chunk);
    const rules =
      `CRITICAL INSTRUCTIONS:\n` +
      `1. The input is a JSON ARRAY of strings. You must translate each string.\n` +
      `2. Return the translated strings separated by the delimiter "|||||".\n` +
      `3. Do NOT use JSON for the output. Just text separated by |||||.\n` +
      `4. Maintain the EXACT order and number of items.\n` +
      `5. Do NOT translate text inside equal signs like __EMAIL_0__ or __URL_1__.\n` +
      `6. Example output: Translated Text 1|||||Translated Text 2|||||Translated Text 3`;

    try {
      console.log(
        `[aiService] invoking translate Edge Function for chunk ${i}`
      );
      const { data, error } = await supabase.functions.invoke("translate", {
        body: {
          text: userPrompt,
          targetLang: targetLang,
          guidelines: rules,
        },
      });

      if (error) {
        console.error(`Translation Edge Function error for chunk ${i}:`, error);
        throw new Error(error.message || "Edge function failed");
      }

      if (data?.error) {
        console.error(
          `Translation Edge Function returned error for chunk ${i}:`,
          data.error
        );
        throw new Error(data.error);
      }

      const rawOutput = data?.translatedText;
      if (!rawOutput) {
        throw new Error("No translatedText in response");
      }

      // Parse Output
      // Split by delimiter
      let chunkTranslations = rawOutput.split("|||||");

      // Cleanup whitespace around split (optional, but good for safety)
      chunkTranslations = chunkTranslations.map((t: string) => t.trim());

      // Validation: If length doesn't match, we might have an issue, but usually it's better to process what we have
      if (chunkTranslations.length !== chunk.length) {
        console.warn(
          `[aiService] Translation count mismatch. Expected ${chunk.length}, got ${chunkTranslations.length}. Aligning best effort.`
        );
        // If we got fewer, fill with original
        while (chunkTranslations.length < chunk.length) {
          chunkTranslations.push(chunk[chunkTranslations.length]);
        }
        // If we got more, truncate
        if (chunkTranslations.length > chunk.length) {
          chunkTranslations = chunkTranslations.slice(0, chunk.length);
        }
      }

      // 4. Detokenize and Reassemble
      chunkTranslations.forEach((transText: string, idx: number) => {
        const globalIdx = i + idx;
        if (globalIdx < tokenizedSegments.length) {
          const originalTokens = tokenizedSegments[globalIdx].tokens;
          const finalText = detokenize(transText, originalTokens);
          translatedSegments.push({
            id: tokenizedSegments[globalIdx].id,
            text: finalText,
          });
        }
      });
    } catch (error) {
      console.error(`Translation chunk ${i} failed:`, error);
      // Fallback for this chunk
      chunk.forEach((txt, idx) => {
        translatedSegments.push({
          id: segments[i + idx].id,
          text: segments[i + idx].text,
        });
      });
    }
  }

  return translatedSegments;
};
