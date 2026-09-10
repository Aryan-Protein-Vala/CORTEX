export interface CortexConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface GraphResponse {
  nodes: any[];
  edges: any[];
  context: string;
}

export class Cortex {
  private apiKey: string;
  private baseUrl: string;

  constructor(config: string | CortexConfig) {
    if (typeof config === 'string') {
      this.apiKey = config;
      this.baseUrl = (typeof process !== 'undefined' && process.env?.CORTEX_API_URL) || 'http://127.0.0.1:3030';
    } else {
      this.apiKey = config.apiKey || 'cortex-local-key';
      this.baseUrl = config.baseUrl || (typeof process !== 'undefined' && process.env?.CORTEX_API_URL) || 'http://127.0.0.1:3030';
    }
  }

  /**
   * Recalls relevant memory context for an agent query or user prompt
   * @param prompt Query string to recall relevant graph memories
   * @param options Optional user_id and token_budget (default: 500)
   */
  async recall(prompt: string, options?: { userId?: string; tokenBudget?: number }): Promise<GraphResponse> {
    const response = await fetch(`${this.baseUrl}/v1/recall`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        user_id: options?.userId || 'default_user',
        prompt,
        token_budget: options?.tokenBudget || 500
      })
    });

    if (!response.ok) {
      throw new Error(`Cortex API error: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Fetches the context graph for a given user or team via the custom protocol
   * @param uri e.g. "cortex://user_123" or "cortex://team_eng"
   * @param includeMesh Whether to also merge knowledge from cortex://global
   */
  async getGraph(uri: string, includeMesh: boolean = false): Promise<GraphResponse> {
    if (!uri.startsWith('cortex://')) {
      throw new Error("Invalid Cortex URI. Must start with 'cortex://'");
    }

    const url = `${this.baseUrl}/v1/resolve?uri=${encodeURIComponent(uri)}${includeMesh ? '&include_mesh=true' : ''}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Cortex API error: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Injects new memory into a user's graph
   * @param uri e.g. "cortex://user_123"
   * @param text The raw natural language input to parse into the graph
   */
  async injectMemory(uri: string, text: string): Promise<boolean> {
    if (!uri.startsWith('cortex://')) {
      throw new Error("Invalid Cortex URI. Must start with 'cortex://'");
    }

    const response = await fetch(`${this.baseUrl}/v1/inject`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ uri, text })
    });

    if (!response.ok) {
      throw new Error(`Cortex API error: ${response.statusText}`);
    }

    return true;
  }

  /**
   * Publishes knowledge nodes and edges to the decentralized Global Mesh (cortex://global)
   */
  async publishToMesh(nodes: any[], edges: any[]): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/v1/mesh/publish`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ nodes, edges })
    });

    if (!response.ok) {
      throw new Error(`Cortex API error: ${response.statusText}`);
    }

    return true;
  }
}
