import { useState, useCallback, useRef, useEffect } from 'react';
import { RealtimeSession } from '@openai/agents-realtime';
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
      const { client_secret } = data;
      
      // Create agent
      const agent = createRoleplayAgent(scenario);
      
      // Create RealtimeSession (automatically uses WebRTC in browser)
      const session = new RealtimeSession(agent, {
        model: 'gpt-4o-realtime-preview-2025-06-03',
        input_audio_transcription: {
          model: 'whisper-1'
        }
      } as any);
      
      // Set up event listeners
      session.on('error', (error: any) => {
        console.error('Session error:', error);
        setState(prev => ({ 
          ...prev, 
          error: error.message || 'Unknown error occurred' 
        }));
      });

      (session as any).on('conversation.item.completed', (event: any) => {
        if (event.item.type === 'message') {
          const content = event.item.formatted?.text || event.item.content?.[0]?.text || '';
          setState(prev => ({
            ...prev,
            history: [...prev.history, {
              role: event.item.role,
              content,
              timestamp: new Date(),
            }],
          }));
        }
      });

      (session as any).on('input_audio_buffer.speech_started', () => {
        // User started speaking
      });

      (session as any).on('input_audio_buffer.speech_stopped', () => {
        // User stopped speaking
      });

      // Connect using ephemeral key
      await session.connect({ 
        apiKey: client_secret.value
      });

      sessionRef.current = session;
      
      setState(prev => ({ 
        ...prev, 
        isConnecting: false, 
        isConnected: true 
      }));
      
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
      (sessionRef.current as any).disconnect();
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
        // Interrupt if currently speaking when muting
        if (newMuted && sessionRef.current) {
          (sessionRef.current as any).interrupt();
        }
        return { ...prev, isMuted: newMuted };
      });
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        (sessionRef.current as any).disconnect();
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