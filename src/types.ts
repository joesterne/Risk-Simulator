export type GraphNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: { label: string; riskLevel?: 'low' | 'medium' | 'high'; description?: string; category?: string; utilization?: number; throughput?: number; };
  hidden?: boolean;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  type?: string;
  animated?: boolean;
};

export type EventAlert = {
  id: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  timestamp: string;
};

export type TimelineEvent = {
  id: string;
  date: string;
  title: string;
  description: string;
};

export type SimulationHistoryEntry = {
  id: string;
  prompt: string;
  summary: string;
  date: string;
};

export type AppState = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  alerts: EventAlert[];
  timeline: TimelineEvent[];
  history?: SimulationHistoryEntry[];
};
