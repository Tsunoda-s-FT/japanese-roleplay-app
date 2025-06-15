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
      // エフェメラルキーを取得
      const response = await fetch('/api/session');
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get session token');
      }
      
      const data = await response.json();
      console.log('Ephemeral key response:', data);
      
      // エージェントを作成
      const agent = createRoleplayAgent(scenario);
      
      // RealtimeSessionを作成（SDKが自動的にWebRTCを選択）
      const session = new RealtimeSession(agent, {
        model: 'gpt-4o-realtime-preview-2025-06-03',
        voice: 'alloy',
      } as any);
      
      // 接続状態のリスナー
      (session as any).on('connected', () => {
        console.log('Session connected');
        setState(prev => ({ 
          ...prev, 
          isConnecting: false, 
          isConnected: true 
        }));
      });

      (session as any).on('disconnected', () => {
        console.log('Session disconnected');
        setState(prev => ({ 
          ...prev, 
          isConnected: false 
        }));
      });

      // エラーハンドリング
      session.on('error', (error: any) => {
        console.error('Session error:', error);
        setState(prev => ({ 
          ...prev, 
          error: error.message || 'Unknown error occurred',
          isConnecting: false,
        }));
      });

      // 会話の追跡
      (session as any).on('conversation.updated', (event: any) => {
        const { item } = event;
        if (item && item.type === 'message') {
          const content = item.content?.[0]?.text || '';
          if (content) {
            setState(prev => ({
              ...prev,
              history: [...prev.history, {
                role: item.role,
                content,
                timestamp: new Date(),
              }],
            }));
          }
        }
      });

      // 音声入力の文字起こし
      (session as any).on('input_audio_transcription.completed', (event: any) => {
        if (event.transcript) {
          setState(prev => ({
            ...prev,
            history: [...prev.history, {
              role: 'user',
              content: event.transcript,
              timestamp: new Date(),
            }],
          }));
        }
      });

      // エフェメラルキーで接続
      // client_secretオブジェクトから値を正しく取得
      const apiKey = data.client_secret?.value || data.client_secret;
      
      console.log('Connecting with key:', apiKey ? apiKey.substring(0, 10) + '...' : 'No key found');
      
      await session.connect({ 
        apiKey: apiKey
      });

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
        // SDKのミュート機能を使用
        if (sessionRef.current) {
          // interruptメソッドで音声を中断
          if (newMuted) {
            (sessionRef.current as any).interrupt();
          }
        }
        return { ...prev, isMuted: newMuted };
      });
    }
  }, []);

  // クリーンアップ
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