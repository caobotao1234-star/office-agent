/**
 * LLM Client interface — abstract layer for LLM calls.
 * Concrete implementations will be provided when a specific LLM is integrated.
 */
export interface LLMClient {
  /** Send a query to the LLM and return the full text response. */
  query(system: string, user: string, signal: AbortSignal): Promise<string>;

  /**
   * Send a query and stream back token-by-token.
   * Yields partial text chunks as they arrive.
   * Optional — falls back to query() if not implemented.
   */
  queryStream?(system: string, user: string, signal: AbortSignal): AsyncGenerator<string>;
}
