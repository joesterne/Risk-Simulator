import React, { useState, useCallback, useEffect } from 'react';
import ReactFlow, {
  Controls,
  Background,
  applyNodeChanges,
  applyEdgeChanges,
  NodeChange,
  EdgeChange,
  Node,
  Edge,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { AppState, GraphNode, GraphEdge } from '../types';
import { CustomNode } from './CustomNode';

const nodeTypes = {
  custom: CustomNode,
  default: CustomNode,
  input: CustomNode,
  output: CustomNode,
};

interface GraphCanvasProps {
  appState: AppState;
  setAppState: (state: AppState) => void;
  broadcastState: (state: AppState) => void;
  searchTerm?: string;
  hideLowRisk?: boolean;
}

export function GraphCanvas({ appState, setAppState, broadcastState, searchTerm = '', hideLowRisk = false }: GraphCanvasProps) {
  const [nodes, setNodes] = useState<Node[]>(appState.nodes);
  const [edges, setEdges] = useState<Edge[]>(appState.edges);

  useEffect(() => {
    const searchLower = searchTerm.toLowerCase();
    
    // We want to update the hidden property on nodes based on search and filters
    const visibleNodeIds = new Set<string>();

    const nextNodes = appState.nodes.map(n => {
      const matchSearch = searchLower === '' || (n.data?.label || '').toLowerCase().includes(searchLower) || (n.data?.description || '').toLowerCase().includes(searchLower);
      const matchRisk = !hideLowRisk || n.data?.riskLevel !== 'low';
      const isVisible = matchSearch && matchRisk;
      
      if (isVisible) {
        visibleNodeIds.add(n.id);
      }
      
      return {
        ...n,
        hidden: !isVisible,
      };
    });

    const nextEdges = appState.edges.map(e => {
      return {
        ...e,
        hidden: !visibleNodeIds.has(e.source) || !visibleNodeIds.has(e.target)
      };
    });

    setNodes(nextNodes);
    setEdges(nextEdges);
  }, [appState.nodes, appState.edges, searchTerm, hideLowRisk]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const newNodes = applyNodeChanges(changes, nodes);
      setNodes(newNodes);
      
      // Update app state and broadcast
      const newState = { ...appState, nodes: newNodes as GraphNode[] };
      setAppState(newState);
      broadcastState(newState);
    },
    [nodes, appState, setAppState, broadcastState]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const newEdges = applyEdgeChanges(changes, edges);
      setEdges(newEdges);
      
      const newState = { ...appState, edges: newEdges as GraphEdge[] };
      setAppState(newState);
      broadcastState(newState);
    },
    [edges, appState, setAppState, broadcastState]
  );

  return (
    <div className="w-full h-full min-h-[400px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
