import { useState, useCallback, useRef, useEffect } from 'react';
import { RealtimeSession, OpenAIRealtimeWebRTC } from '@openai/agents-realtime';
import { createRoleplayAgent, ScenarioKey } from '@/lib/agents/roleplayAgent';

export interface SessionState {
  isConnecting: boolean;
  isConnected: boolean;
  error: string | null;
  isMuted: boolean;
  scenario: ScenarioKey | null;
  history: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }>;
}

export function useRealtimeSession() {
  const [state, setState] = useState<SessionState>({
    isConnecting: false,
    isConnected: false,
    error: null,
    isMuted: false,
    scenario: null,
    history: [],
  });

  const sessionRef = useRef<RealtimeSession | null>(null);

  const connect = useCallback(async (scenario: ScenarioKey) => {
    setState(prev => ({ ...prev, isConnecting: true, error: null, scenario }));

    try {
      // Get ephemeral key from server
      const response = await fetch('/api/session');
      if (!response.ok) {
        throw new Error('Failed to get session token');
      }
      
      const data = await response.json();
      console.log('Client data:', data);
      const { client_secret } = data;
      
      // Create agent and session with WebRTC transport
      const agent = createRoleplayAgent(scenario);
      
      // Get audio permissions and create transport
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioElement = document.createElement('audio');
      audioElement.autoplay = true;
      
      const transport = new OpenAIRealtimeWebRTC({
        mediaStream,
        audioElement,
        model: 'gpt-4o-realtime-preview-2025-06-03'
      });
      
      const session = new RealtimeSession(agent, { 
        transport
      });
      
      // Set up event listeners
      session.on('connection.state.changed', (event: any) => {
        if (event.type === 'connected') {
          setState(prev => ({ 
            ...prev, 
            isConnecting: false, 
            isConnected: true 
          }));
        } else if (event.type === 'disconnected') {
          setState(prev => ({ 
            ...prev, 
            isConnected: false 
          }));
        }
      });

      session.on('input_audio_transcription.completed', (event: any) => {
        setState(prev => ({
          ...prev,
          history: [...prev.history, {
            role: 'user',
            content: event.transcript,
            timestamp: new Date(),
          }],
        }));
      });

      session.on('response.output_item.completed', (event: any) => {
        if (event.item.type === 'message' && event.item.role === 'assistant') {
          const content = event.item.content?.[0]?.text || '';
          setState(prev => ({
            ...prev,
            history: [...prev.history, {
              role: 'assistant',
              content,
              timestamp: new Date(),
            }],
          }));
        }
      });

      session.on('error', (error: any) => {
        console.error('Session error:', error);
        setState(prev => ({ 
          ...prev, 
          error: error.message || 'Unknown error occurred' 
        }));
      });

      // Connect to session - use client_secret.value if it's an object
      const apiKey = typeof client_secret === 'object' ? client_secret.value : client_secret;
      console.log('Connecting with apiKey:', apiKey);
      
      await session.connect({ 
        apiKey: apiKey
      });
      
      // Session is already configured via constructor options
      // Additional configuration can be done via transport if needed

      sessionRef.current = session;
      
    } catch (error) {
      console.error('Connection error:', error);
      setState(prev => ({ 
        ...prev, 
        isConnecting: false, 
        error: error instanceof Error ? error.message : 'Failed to connect' 
      }));
    }
  }, []);

  const disconnect = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.disconnect();
      sessionRef.current = null;
    }
    setState(prev => ({ 
      ...prev, 
      isConnected: false,
      scenario: null,
      history: [],
    }));
  }, []);

  const toggleMute = useCallback(() => {
    if (sessionRef.current) {
      setState(prev => {
        const newMuted = !prev.isMuted;
        // Toggle microphone mute state via transport
        if (newMuted && sessionRef.current?.transport) {
          sessionRef.current.transport.sendEvent({
            type: 'input_audio_buffer.clear',
          });
        }
        return { ...prev, isMuted: newMuted };
      });
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        sessionRef.current.disconnect();
      }
    };
  }, []);

  return {
    state,
    connect,
    disconnect,
    toggleMute,
  };
}