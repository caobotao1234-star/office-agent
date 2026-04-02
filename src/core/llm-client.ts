/**
 * LLM Client interface — abstract layer for LLM calls.
 * Concrete implementations will be provided when a specific LLM is integrated.
 */
export interface LLMClient {
  /** Send a query to the LLM and return the text response. */
  query(system: string, user: string, signal: AbortSignal): Promise<string>;
}
