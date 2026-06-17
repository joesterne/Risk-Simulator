import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GraphCanvas } from './components/GraphCanvas';
import { useLiveVoice } from './hooks/useLiveVoice';
import { initAuth, googleSignIn, logout } from './lib/auth';
import { User } from 'firebase/auth';
import { AppState, EventAlert } from './types';
import { saveToDrive, sendChatAlert } from './lib/workspace';
import { ShieldAlert, Activity, Play, Square, Save, Mic, Send, LogOut, Clock, Link as LinkIcon, HardDrive, MessageSquare, Image, Video } from 'lucide-react';
import { cn } from './lib/utils';
import ReactMarkdown from 'react-markdown';

const DEFAULT_STATE: AppState = {
  nodes: [
    { id: '1', type: 'custom', position: { x: 250, y: 5 }, data: { label: 'Global Trade Hub', riskLevel: 'medium', utilization: 85 } },
    { id: '2', type: 'custom', position: { x: 100, y: 120 }, data: { label: 'Regional Factory', riskLevel: 'low', utilization: 42 } },
    { id: '3', type: 'custom', position: { x: 400, y: 120 }, data: { label: 'Distribution Center', riskLevel: 'high', utilization: 92, description: "Backlog due to missing containers" } }
  ],
  edges: [
    { id: 'e1-2', source: '1', target: '2', animated: true },
    { id: 'e1-3', source: '1', target: '3', animated: true }
  ],
  alerts: [],
  timeline: [],
  history: []
};

function EventSuggestion({ suggestion, onClick }: { suggestion: string, onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-xs bg-white/5 text-white/60 hover:text-white hover:bg-white/10 px-2 py-1 rounded border border-white/10 transition">
      {suggestion}
    </button>
  );
}

export default function App() {
  const [appState, setAppState] = useState<AppState>(DEFAULT_STATE);
  const [user, setUser] = useState<User | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [eventInput, setEventInput] = useState('');
  const [isSimulating, setIsSimulating] = useState(false);
  const [graphSearch, setGraphSearch] = useState('');
  const [hideLowRisk, setHideLowRisk] = useState(false);
  const [rightTab, setRightTab] = useState<'alerts' | 'history'>('alerts');
  const [historySearch, setHistorySearch] = useState('');
  const { isActive: liveVoiceActive, startVoice } = useLiveVoice();
  
  const suggestions = [
    "Suez Canal blockade",
    "Taiwan semiconductor shortage",
    "European energy crisis"
  ];

  // Initialize auth
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setUser(user);
        setNeedsAuth(false);
      },
      () => {
        setNeedsAuth(true);
        setUser(null);
      }
    );
    return () => unsubscribe();
  }, []);

  // Connect to Collab WS
  useEffect(() => {
    let socket: WebSocket;
    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${proto}//${window.location.host}/collaboration`);
      
      socket.onopen = () => setWs(socket);
      
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'init' || msg.type === 'sync') {
            if (msg.state.nodes && msg.state.nodes.length > 0) {
              setAppState(msg.state);
            }
          }
        } catch (e) {
          console.error('WS Error:', e);
        }
      };

      socket.onclose = () => {
        setTimeout(connect, 2000); // Reconnect logic
      };
    };

    connect();
    return () => {
      if (socket) socket.close();
    };
  }, []);

  const broadcastState = useCallback((newState: AppState) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'sync', state: newState }));
    }
  }, [ws]);

  const handleSimulate = async () => {
    if (!eventInput.trim() || isSimulating) return;
    setIsSimulating(true);

    try {
      const res = await fetch('/api/gemini/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: `Simulate this event's impact on the supply chain: "${eventInput}". Current graph size: ${appState.nodes.length} nodes.`,
          currentState: appState
        })
      });
      
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        throw new Error(res.status === 429 ? "API quota exceeded. Please check your Gemini API plan or try again later." : "Server returned invalid format: " + text.substring(0, 50));
      }

      if (!res.ok) throw new Error(data.error || 'Simulation failed.');
      
      if (data.result) {
        // Attempt to parse out new Nodes/Edges from text result. The backend output might be raw JSON mixed with text.
        try {
          const jsonMatch = data.result.match(/```json\s*([\s\S]*?)\s*```/) || data.result.match(/([\{\[][\s\S]*[\}\]])/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[1]);
            
            // Assume parsed has newNodes, newEdges, alerts, timeline
            const newState = { ...appState };
            
            if (parsed.newNodes && Array.isArray(parsed.newNodes)) {
              newState.nodes = [...newState.nodes, ...parsed.newNodes];
            }
            if (parsed.newEdges && Array.isArray(parsed.newEdges)) {
              newState.edges = [...newState.edges, ...parsed.newEdges];
            }
            if (parsed.timeline && Array.isArray(parsed.timeline)) {
              newState.timeline = [...newState.timeline, ...parsed.timeline];
            }
            if (parsed.alert) {
              newState.alerts = [{
                id: Math.random().toString(36).substr(2, 9),
                title: parsed.alert.title || "Supply Chain Alert",
                description: parsed.alert.description || data.result,
                severity: parsed.alert.severity || "high",
                timestamp: new Date().toISOString()
              }, ...newState.alerts];
            }
            
            newState.history = [{
              id: Math.random().toString(36).substr(2, 9),
              prompt: eventInput,
              summary: parsed.alert?.description || "Simulation applied.",
              date: new Date().toISOString()
            }, ...(newState.history || [])];

            setAppState(newState);
            broadcastState(newState);
          }
        } catch (e) {
             // Fallback: Create a generic alert if json parsing fails
             const genericAlert: EventAlert = {
                id: Math.random().toString(36).substr(2, 9),
                title: "Impact Analysis: " + eventInput,
                description: data.result.substring(0, 200) + "...",
                severity: "medium",
                timestamp: new Date().toISOString()
             };
             
             const genericHistory = {
               id: Math.random().toString(36).substr(2, 9),
               prompt: eventInput,
               summary: `Simulation completed successfully.`,
               date: new Date().toISOString()
             };

             const newState = { 
               ...appState, 
               alerts: [genericAlert, ...appState.alerts],
               history: [genericHistory, ...(appState.history || [])]
             };
             setAppState(newState);
             broadcastState(newState);
        }
      }
    } catch (e: any) {
      console.warn("Simulation Error:", e.message);
      const errorAlert: EventAlert = {
        id: Math.random().toString(36).substr(2, 9),
        title: "Simulation Error",
        description: e.message || 'Simulation request failed.',
        severity: "high",
        timestamp: new Date().toISOString()
      };
      const newState = { ...appState, alerts: [errorAlert, ...appState.alerts] };
      setAppState(newState);
      broadcastState(newState);
    } finally {
      setIsSimulating(false);
      setEventInput('');
    }
  };

  const onSaveDrive = async () => {
    if (needsAuth) return alert('Please sign in first');
    const id = await saveToDrive(`supply-chain-simulation-${new Date().toISOString()}.json`, JSON.stringify(appState, null, 2));
    if (id) {
       alert('Successfully saved to Drive! Check your Google Drive.');
    }
  };

  const onSendChat = async () => {
    if (needsAuth) return alert('Please sign in first');
    const spaceId = window.prompt("Enter Google Chat Space ID (e.g., spaces/AAAABBBBCCC)");
    if (spaceId) {
       const latestAlert = appState.alerts[0];
       const desc = latestAlert ? latestAlert.description : "No recent alerts. The simulation is stable.";
       const ok = await sendChatAlert(spaceId, `*Simulation Alert*\n${desc}`);
       if (ok) alert('Sent to Google Chat space!');
       else alert('Failed to send to Chat. Verify space ID and scopes.');
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#050505] text-[#e0e0e0] font-sans">
      {/* Header View */}
      <header className="flex-none flex items-center justify-between px-6 h-14 border-b border-white/10 bg-[#0a0a0a] relative z-10">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center text-white font-bold">
            <Activity size={20} />
          </div>
          <div>
            <h1 className="text-lg font-medium tracking-tight text-white">Global Flow <span className="text-white/40 font-light ml-2 uppercase text-[10px] tracking-widest">Cascade Simulator</span></h1>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full", ws ? "bg-green-500 animate-pulse" : "bg-red-500 animate-pulse")} />
            <span className="text-[10px] text-white/60 uppercase tracking-widest">{ws ? 'Live Sync: Active' : 'Connecting...'}</span>
          </div>

          <button onClick={startVoice} className={cn("px-4 py-1.5 border rounded text-xs transition-colors flex items-center gap-2", 
            liveVoiceActive ? "bg-red-900/20 text-red-400 border-red-500/50 pulse" : "bg-white/5 border-white/10 hover:bg-white/10 text-[#e0e0e0]")}>
            <Mic size={14} />
            {liveVoiceActive ? "Listening..." : "Live AI"}
          </button>

          {needsAuth ? (
             <button onClick={googleSignIn} className="text-xs px-4 py-1.5 bg-white border border-white text-black font-medium uppercase tracking-widest rounded shadow-sm hover:bg-gray-200 transition">
               Sign in
             </button>
          ) : (
            <div className="flex items-center gap-3">
               <span className="text-sm font-medium">{user?.displayName}</span>
               <button onClick={logout} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 transition" title="Log out">
                 <LogOut size={16} />
               </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Layout Area */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Left Sidebar Actions & NLP Event Entry */}
        <div className="w-80 flex-none border-r border-white/10 flex flex-col bg-[#080808] p-4 overflow-y-auto">
           <h2 className="text-[10px] text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2">
             <Play size={14} /> Add Event
           </h2>

           <div className="flex flex-col gap-3 mb-8">
             <label className="text-[10px] text-white/40 uppercase tracking-widest mb-2 block">Natural Language Scenarios</label>
             <textarea 
               value={eventInput}
               onChange={e => setEventInput(e.target.value)}
               placeholder="Describe a real world event (e.g. A major port strike in Los Angeles limits ocean freight capacity by 40%)..."
               className="w-full h-32 bg-transparent border border-white/10 rounded p-3 text-sm focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition resize-none placeholder-white/20"
             />
             <div className="flex flex-wrap gap-2">
               {suggestions.map((s, i) => (
                 <EventSuggestion key={i} suggestion={s} onClick={() => setEventInput(s)} />
               ))}
             </div>
             
             <button
               onClick={handleSimulate}
               disabled={isSimulating || !eventInput}
               className="mt-2 w-full text-left bg-white/5 text-blue-400 border border-blue-500/30 font-medium text-sm py-2 px-3 rounded hover:bg-white/10 disabled:opacity-50 transition flex items-center justify-center gap-2"
             >
               {isSimulating ? <Activity className="animate-spin" size={16}/> : <Send size={16}/>}
               {isSimulating ? 'Simulating...' : 'Run Simulation'}
             </button>
           </div>

           <div className="h-px bg-white/10 w-full my-6"></div>

           <h2 className="text-[10px] text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2 mt-8">
             <Image size={14} /> Asset Generator
           </h2>

           <div className="flex flex-col gap-3">
             <button onClick={async () => {
               const p = prompt("Enter prompt for a supply chain crisis visual mapping image:");
               if (!p) return;
               try {
                 const r = await fetch('/api/gemini/generate-image', {
                   method: 'POST',
                   headers: { 'Content-Type': 'application/json' },
                   body: JSON.stringify({ prompt: p, size: '2K' })
                 });
                 const text = await r.text();
                 let d;
                 try { d = JSON.parse(text); } catch(e) { throw new Error(r.status === 429 ? "API quota exceeded. Please check your Gemini API plan or try again later." : text.substring(0, 50)); }
                 if (!r.ok) throw new Error(d.error || "Failed generating image.");
                 if (d.imageUrl) {
                   const win = window.open();
                   win?.document.write(`<img src="${d.imageUrl}" />`);
                 }
               } catch(e: any) { 
                 const errorAlert: EventAlert = {
                   id: Math.random().toString(36).substr(2, 9),
                   title: "Image Generation Error",
                   description: e.message || "Failed generating image.",
                   severity: "high",
                   timestamp: new Date().toISOString()
                 };
                 setAppState(prev => ({ ...prev, alerts: [errorAlert, ...prev.alerts] }));
               }
             }} className="flex items-center justify-center gap-2 w-full bg-white/5 border border-white/10 hover:bg-white/10 p-2 rounded text-sm transition text-[#e0e0e0]">
               Generate 2K Scenario Map
             </button>
           </div>
           
           <h2 className="text-[10px] text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2 mt-8">
             <Video size={14} /> Video Intel
           </h2>

           <div className="flex flex-col gap-3">
             <label className="flex items-center justify-center gap-2 w-full bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/30 p-2 rounded text-sm cursor-pointer transition">
               <span>Upload footage for AI analysis</span>
               <input type="file" accept="video/mp4,video/webm" className="hidden" onChange={async (e) => {
                 const file = e.target.files?.[0];
                 if (!file) return;
                 const reader = new FileReader();
                 reader.onload = async (re) => {
                    const base64 = (re.target?.result as string).split(',')[1];
                    try {
                      alert("Analyzing video with Deep Thinking model... This may take a minute.");
                      const r = await fetch('/api/gemini/analyze-video', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ videoBase64: base64, mimeType: file.type })
                      });
                      const text = await r.text();
                      let d;
                      try { d = JSON.parse(text); } catch(e) { throw new Error(r.status === 429 ? "API quota exceeded. Please check your Gemini API plan or try again later." : text.substring(0, 50)); }
                      if (!r.ok) throw new Error(d.error || "Failed to analyze video.");
                      if (d.result) {
                        alert("Analysis Result:\n\n" + d.result);
                      }
                    } catch (e: any) {
                      const errorAlert: EventAlert = {
                        id: Math.random().toString(36).substr(2, 9),
                        title: "Video Analysis Error",
                        description: e.message || "Failed to analyze video.",
                        severity: "high",
                        timestamp: new Date().toISOString()
                      };
                      setAppState(prev => ({ ...prev, alerts: [errorAlert, ...prev.alerts] }));
                    }
                 };
                 reader.readAsDataURL(file);
               }} />
             </label>
           </div>

           <h2 className="text-[10px] text-white/40 uppercase tracking-widest mb-4 flex items-center gap-2 mt-8">
             <HardDrive size={14} /> Export Reports
           </h2>
           
           <div className="flex flex-col gap-3">
             <button onClick={onSaveDrive} className="flex items-center gap-3 w-full bg-white/5 border border-white/10 hover:bg-white/10 p-3 rounded text-sm text-left transition">
               <HardDrive className="text-white/60" size={16} />
               <div className="flex flex-col">
                  <span className="font-medium text-[#e0e0e0]">Save to Drive</span>
                  <span className="text-[10px] text-white/40 uppercase tracking-widest mt-1">Store JSON snapshot version</span>
               </div>
             </button>

             <button onClick={onSendChat} className="flex items-center gap-3 w-full bg-white/5 border border-white/10 hover:bg-white/10 p-3 rounded text-sm text-left transition">
               <MessageSquare className="text-white/60" size={16} />
               <div className="flex flex-col">
                  <span className="font-medium text-[#e0e0e0]">Push to Chat</span>
                  <span className="text-[10px] text-white/40 uppercase tracking-widest mt-1">Broadcast latest alerts to team</span>
               </div>
             </button>
           </div>
        </div>

        {/* Center Canvas */}
        <div className="flex flex-1 flex-col relative bg-[#050505] border-r border-white/10">
           {/* Grid Background */}
           <div className="absolute inset-0 opacity-10 pointer-events-none"
                style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
           <div className="flex-1 p-6 z-0 flex flex-col h-full relative">
             <div className="flex items-center justify-between mb-4 flex-none">
               <div className="flex items-center gap-4">
                 <h3 className="text-[10px] text-white/40 uppercase tracking-widest">Relational Web</h3>
                 <input 
                   type="text" 
                   placeholder="Search..." 
                   value={graphSearch} 
                   onChange={e => setGraphSearch(e.target.value)} 
                   className="bg-transparent border border-white/10 rounded px-2 py-1 text-xs text-[#e0e0e0] focus:border-blue-500/50 outline-none w-48 placeholder-white/20"
                 />
                 <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer">
                   <input 
                     type="checkbox" 
                     checked={hideLowRisk} 
                     onChange={e => setHideLowRisk(e.target.checked)} 
                     className="accent-blue-500"
                   />
                   Hide Low Risk
                 </label>
               </div>
               <span className="text-xs text-white/60 uppercase tracking-widest">Node Sync Active</span>
             </div>
             
             {/* The Graph Canvas itself is given flexible bounds */}
             <div className="w-full h-3/5 min-h-0 rounded overflow-hidden shadow-[0_0_30px_rgba(255,255,255,0.02)] border border-white/10 custom-graph-container mb-6 flex-none bg-[#050505]">
                <GraphCanvas appState={appState} setAppState={setAppState} broadcastState={broadcastState} searchTerm={graphSearch} hideLowRisk={hideLowRisk} />
             </div>

             <div className="flex-1 min-h-0 flex flex-col">
               <div className="flex items-center justify-between mb-4 flex-none">
                 <h3 className="text-[10px] text-white/40 uppercase tracking-widest">Event Timeline</h3>
               </div>
               <div className="flex-1 bg-[#080808] border border-white/10 rounded overflow-x-auto flex gap-6 items-center snap-x p-4">
                 {appState.timeline.length === 0 ? (
                    <p className="text-white/40 text-sm m-auto">No events on the timeline.</p>
                 ) : (
                    appState.timeline.map((evt, idx) => (
                      <div key={evt.id} className="snap-center shrink-0 w-64 bg-white/5 p-4 rounded border border-white/10 relative">
                        {idx !== appState.timeline.length - 1 && (
                          <div className="absolute top-1/2 -right-6 w-6 h-px bg-white/20" />
                        )}
                        <span className="text-[10px] uppercase text-blue-400 tracking-widest font-bold mb-2 block">{new Date(evt.date).toLocaleDateString()}</span>
                        <h4 className="text-sm font-semibold text-[#e0e0e0] mb-2">{evt.title}</h4>
                        <p className="text-xs text-white/60 line-clamp-3">{evt.description}</p>
                      </div>
                    ))
                 )}
               </div>
             </div>
           </div>
        </div>

        {/* Right Sidebar - Alerts and Details */}
        <div className="w-80 flex-none bg-[#080808] p-4 flex flex-col gap-6 overflow-y-auto">
          <div className="flex bg-white/5 p-1 rounded-md mb-2">
            <button onClick={() => setRightTab('alerts')} className={cn("flex-1 text-xs font-medium uppercase tracking-widest py-1.5 rounded", rightTab === 'alerts' ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60")}>
              Alerts
            </button>
            <button onClick={() => setRightTab('history')} className={cn("flex-1 text-xs font-medium uppercase tracking-widest py-1.5 rounded", rightTab === 'history' ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60")}>
              History
            </button>
          </div>

          {rightTab === 'alerts' ? (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-[#e0e0e0] flex items-center gap-2 mb-4">
                <span className="w-2 h-2 rounded-full bg-red-500"></span> AI-Driven Risk Alerts
              </h3>
              
              <div className="flex flex-col gap-4">
                {appState.alerts.length === 0 ? (
                  <div className="text-xs text-white/50 border border-white/10 rounded p-4 text-center bg-white/5">No active alerts. Flow is stable.</div>
                ) : (
                  appState.alerts.map((alert) => (
                    <div key={alert.id} className={cn("rounded border p-3", 
                          alert.severity === 'high' ? 'bg-red-900/10 border-red-900/50' : 
                          alert.severity === 'medium' ? 'bg-amber-900/10 border-amber-900/50' : 'bg-white/5 border-white/10')}>
                      <div className="flex justify-between items-start mb-2">
                        <h4 className={cn("font-bold text-sm", alert.severity === 'high' ? 'text-red-400' : alert.severity === 'medium' ? 'text-amber-400' : 'text-[#e0e0e0]')}>{alert.title}</h4>
                        <span className={cn("text-[9px] px-2 py-0.5 rounded border uppercase tracking-widest font-bold", 
                          alert.severity === 'high' ? 'bg-red-900/30 text-red-400 border-red-900/50' : 
                          alert.severity === 'medium' ? 'bg-amber-900/30 text-amber-400 border-amber-900/50' : 'bg-white/5 text-white/40 border-white/10')}>
                          {alert.severity}
                        </span>
                      </div>
                      <div className="text-xs text-white/60 line-clamp-3 leading-relaxed mb-2"><ReactMarkdown>{alert.description}</ReactMarkdown></div>
                      <span className="text-[10px] text-white/30 font-mono flex items-center gap-1 mt-3">
                        <Clock size={12} /> {new Date(alert.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-[#e0e0e0] flex items-center gap-2">
                  <Clock size={14} className="text-blue-400" /> Simulation History
                </h3>
                {appState.history && appState.history.length > 0 && (
                  <button 
                    onClick={() => {
                      const newState = { ...appState, history: [] };
                      setAppState(newState);
                      broadcastState(newState);
                    }}
                    className="text-[10px] uppercase tracking-widest text-red-400 hover:text-red-300 transition px-2 py-1 bg-red-400/10 hover:bg-red-400/20 rounded border border-red-400/20"
                  >
                    Clear
                  </button>
                )}
              </div>
              
              <div className="mb-4">
                <input
                  type="text"
                  placeholder="Filter history..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  className="w-full bg-[#111] border border-white/10 rounded px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50"
                />
              </div>

              <div className="flex flex-col gap-4">
                {(!appState.history || appState.history.length === 0) ? (
                  <div className="text-xs text-white/50 border border-white/10 rounded p-4 text-center bg-white/5">No previous simulations.</div>
                ) : (
                  appState.history.filter(item => 
                    item.prompt.toLowerCase().includes(historySearch.toLowerCase()) || 
                    item.summary.toLowerCase().includes(historySearch.toLowerCase())
                  ).length === 0 ? (
                    <div className="text-xs text-white/50 border border-white/10 rounded p-4 text-center bg-white/5">No matching simulations found.</div>
                  ) : (
                    appState.history.filter(item => 
                      item.prompt.toLowerCase().includes(historySearch.toLowerCase()) || 
                      item.summary.toLowerCase().includes(historySearch.toLowerCase())
                    ).map((item) => (
                      <div key={item.id} className="rounded border border-white/10 p-3 bg-white/5">
                        <div className="text-xs text-blue-400 mb-2 italic">"{item.prompt}"</div>
                        <div className="text-xs text-white/60 leading-relaxed mb-2"><ReactMarkdown>{item.summary}</ReactMarkdown></div>
                        <span className="text-[10px] text-white/30 font-mono flex items-center gap-1 mt-2">
                          <Clock size={12} /> {new Date(item.date).toLocaleTimeString()}
                        </span>
                      </div>
                    ))
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
