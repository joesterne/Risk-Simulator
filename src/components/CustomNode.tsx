import React from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { cn } from '../lib/utils';

export function CustomNode({ data }: NodeProps) {
  const riskColor = data.riskLevel === 'high' ? 'bg-red-500' : data.riskLevel === 'medium' ? 'bg-amber-500' : 'bg-green-500';
  const utilization = data.utilization !== undefined ? data.utilization : data.throughput;

  return (
    <div className="flex flex-col gap-2 min-w-[120px]">
      <Handle type="target" position={Position.Top} className="!bg-blue-500 !w-2 !h-2 !border-none" />
      <div className="flex justify-between items-center gap-3">
        <span className="font-semibold text-sm tracking-tight">{data.label}</span>
        {data.riskLevel && (
          <span className={cn("w-2 h-2 rounded-full shrink-0 shadow-[0_0_8px_rgba(255,255,255,0.1)]", riskColor,
             data.riskLevel === 'high' ? 'shadow-red-500/50' : 
             data.riskLevel === 'medium' ? 'shadow-amber-500/50' : '')}></span>
        )}
      </div>
      {data.description && (
         <div className="text-[10px] text-white/50 leading-tight">
           {data.description}
         </div>
      )}
      {utilization !== undefined && (
        <div className="mt-1 flex flex-col gap-1 w-full text-[10px]">
          <div className="flex justify-between items-center text-white/40 uppercase tracking-widest font-bold">
             <span>Load</span>
             <span className={cn(
               utilization >= 90 ? "text-red-400" : 
               utilization >= 70 ? "text-amber-400" : "text-blue-400"
             )}>{Math.round(utilization)}%</span>
          </div>
          <div className="w-full bg-black/60 h-1.5 rounded-full overflow-hidden border border-white/5 relative shadow-inner">
            <div 
              className={cn("h-full transition-all duration-500 ease-out", 
                 utilization >= 90 ? "bg-red-500" : 
                 utilization >= 70 ? "bg-amber-500" : "bg-blue-500"
              )} 
              style={{ width: `${Math.max(0, Math.min(100, utilization))}%` }}
            ></div>
          </div>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-blue-500 !w-2 !h-2 !border-none" />
    </div>
  );
}
