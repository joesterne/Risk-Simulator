import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, LiveServerMessage, Modality, ThinkingLevel } from "@google/genai";
import * as http from "http";
import dotenv from "dotenv";

dotenv.config();

let _ai: any = null;
function getAi() {
  if (!_ai) {
    _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _ai;
}
const PORT = 3000;

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  
  app.use(express.json());

  // WebSocket Servers for different routes
  const wssCollab = new WebSocketServer({ noServer: true });
  const wssLive = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = request.url;
    if (pathname === '/collaboration') {
      wssCollab.handleUpgrade(request, socket, head, (ws) => {
        wssCollab.emit('connection', ws, request);
      });
    } else if (pathname === '/live') {
      wssLive.handleUpgrade(request, socket, head, (ws) => {
        wssLive.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  // ========== Collaboration Server Logic ==========
  
  // Basic in-memory state
  let appState = {
    nodes: [],
    edges: [],
    alerts: [],
    timeline: []
  };

  wssCollab.on('connection', (ws) => {
    // Send initial state
    ws.send(JSON.stringify({ type: 'init', state: appState }));

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === 'sync') {
          // A rudimentary sync mechanism. In a real app we'd use CRDTs or operational transforms.
          // For now, client sends the entire state.
          appState = data.state;
          // Broadcast to everyone else
          wssCollab.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'sync', state: appState }));
            }
          });
        }
      } catch (err) {
        console.error('Collab WS Error:', err);
      }
    });
  });

  // ========== Gemini Live API Server Logic ==========
  
  wssLive.on("connection", async (clientWs) => {
    try {
      const session = await getAi().live.connect({
        model: "gemini-3.1-flash-live-preview",
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audio && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ audio }));
            }
            if (message.serverContent?.interrupted && clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: "You are an AI assistant for a global supply chain cause and effect simulator. Users will talk to you about disruptions and risk scenarios.",
        },
      });

      clientWs.on("message", (data) => {
        try {
          const { audio } = JSON.parse(data.toString());
          if (audio) {
             session.sendRealtimeInput({
              audio: { data: audio, mimeType: "audio/pcm;rate=16000" },
            });
          }
        } catch (err) {
          console.error("Live WS parse message error:", err);
        }
      });
      
      clientWs.on("close", () => {
         // session.close() is not available on all genai types, handle gracefully
      });
      
    } catch (err: any) {
      const msg = err?.message || '';
      const isBilling = msg.includes('dunning decision is deny') || err?.status === 403 || msg.includes('PERMISSION_DENIED');
      const isRateLimit = err?.status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
      
      if (isBilling) {
         console.warn("Live API: Billing error.");
         if (clientWs.readyState === WebSocket.OPEN) {
           clientWs.send(JSON.stringify({ error: "Voice AI is currently unavailable due to a Google Cloud billing issue. Please check your GCP project billing status." }));
         }
      } else if (isRateLimit) {
         console.warn("Live API: Rate limit exceeded (429).");
         if (clientWs.readyState === WebSocket.OPEN) {
           clientWs.send(JSON.stringify({ error: "Voice AI is currently unavailable due to API quota limits. Please try again later." }));
         }
      } else {
         console.error("Failed to connect to Live API:", err);
         if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ error: "Failed to connect to Voice AI." }));
         }
      }
      clientWs.close();
    }
  });

  // ========== API Routes ==========

  function handleGeminiError(err: any, res: any, fallbackMessage: string) {
    const msg = err?.message || '';
    if (msg.includes('dunning decision is deny') || err?.status === 403 || msg.includes('PERMISSION_DENIED')) {
      console.warn("Gemini API Billing Error:", msg);
      return res.status(403).json({ error: "Google Cloud Billing issue detected. Please check your GCP project billing status (e.g. payment method may be expired or suspended)." });
    }
    const isRateLimit = err?.status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
    if (isRateLimit) {
      console.warn("Gemini API Rate Limit Exceeded (429)");
      return res.status(429).json({ error: "API quota exceeded. Please check your Gemini API plan or try again later." });
    }
    console.error("Gemini API Error:", err);
    return res.status(500).json({ error: fallbackMessage });
  }

  app.post('/api/gemini/analyze', async (req, res) => {
    try {
      const { prompt, currentState } = req.body;
      
      // We use interactions API with the deep research model as requested for some complex tasks
      // Wait, general tasks use 3.5-flash. Analysis might just need "gemini-3.1-pro-preview" with high thinking.
      const response = await getAi().models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt + "\n\nCurrent Graph State: " + JSON.stringify(currentState),
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json",
          systemInstruction: "You are a supply chain analyst AI. Based on the event described, use googleSearch to find real-world historical or current data. Output ONLY a valid JSON object with `newNodes` (array of GraphNode where type='custom' and data includes 'utilization' as a number 0-100), `newEdges` (array of GraphEdge), `timeline` (array of TimelineEvent with id, date, title, description), and `alert` (object with title, description, severity 'high'|'medium'|'low')."
        }
      });

      res.json({ result: response.text });
    } catch (err: any) {
      handleGeminiError(err, res, "Failed to generate analysis");
    }
  });

  app.post('/api/gemini/complex-analysis', async (req, res) => {
    try {
      const { prompt, currentState } = req.body;
      const response = await getAi().models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt + "\n\nCurrent Graph State: " + JSON.stringify(currentState),
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          systemInstruction: "You are a senior supply chain risk analyst. Provide a deeply detailed, exhaustive text report analyzing the cascading risks, hidden vulnerabilities, and mitigation strategies."
        }
      });
      res.json({ result: response.text });
    } catch (err: any) {
      handleGeminiError(err, res, "Failed to perform deep analysis");
    }
  });

  app.post('/api/gemini/generate-image', async (req, res) => {
    try {
      const { prompt, size } = req.body; // size: '1K', '2K', or '4K'
      const response = await getAi().models.generateContent({
        model: 'gemini-3-pro-image',
        contents: {
          parts: [{ text: prompt }]
        },
        config: {
          imageConfig: {
            aspectRatio: "16:9",
            imageSize: size || '1K'
          }
        }
      });
      // Extract image content
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          return res.json({ imageUrl: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` });
        }
      }
      res.status(500).json({ error: "No image found in response" });
    } catch (err: any) {
      handleGeminiError(err, res, "Failed to generate image");
    }
  });

  app.post('/api/gemini/analyze-video', express.json({limit: '50mb'}), async (req, res) => {
    try {
      const { videoBase64, mimeType } = req.body;
      const response = await getAi().models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: {
          parts: [
            { inlineData: { data: videoBase64, mimeType: mimeType || "video/mp4" } },
            { text: "Analyze this video footage. Identify any supply chain disruption risks, logistics bottlenecks, or potential safety hazards shown." }
          ]
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
        }
      });
      res.json({ result: response.text });
    } catch (err: any) {
      handleGeminiError(err, res, "Failed to analyze video");
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
