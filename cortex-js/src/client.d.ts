export interface CortexConfig {
    apiKey: string;
    baseUrl?: string;
}
export interface GraphResponse {
    nodes: any[];
    edges: any[];
    context: string;
}
export declare class Cortex {
    private apiKey;
    private baseUrl;
    constructor(config: CortexConfig);
    /**
     * Fetches the context graph for a given user or team via the custom protocol
     * @param uri e.g. "cortex://user_123" or "cortex://team_eng"
     */
    getGraph(uri: string): Promise<GraphResponse>;
    /**
     * Injects new memory into a user's graph
     * @param uri e.g. "cortex://user_123"
     * @param text The raw natural language input to parse into the graph
     */
    injectMemory(uri: string, text: string): Promise<boolean>;
}
//# sourceMappingURL=client.d.ts.map