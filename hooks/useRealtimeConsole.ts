import { useState, useCallback, useRef, useEffect } from 'react';
import { ScenarioKey, roleplayScenarios } from '@/lib/agents/roleplayAgent';

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

// OpenAI公式のrealtime-consoleを参考にした実装
export function useRealtimeConsole() {
  const [state, setState] = useState<SessionState>({
    isConnecting: false,
    isConnected: false,
    error: null,
    isMuted: false,
    scenario: null,
    history: [],
  });

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);

  const connect = useCallback(async (scenario: ScenarioKey) => {
    console.log('🟦 === Starting WebRTC Connection ===');
    setState(prev => ({ ...prev, isConnecting: true, error: null, scenario }));

    try {
      // 1. Get ephemeral token
      console.log('📥 Fetching ephemeral token...');
      const tokenResponse = await fetch('/api/session');
      
      if (!tokenResponse.ok) {
        throw new Error('Failed to get ephemeral token');
      }

      const sessionData = await tokenResponse.json();
      const EPHEMERAL_KEY = sessionData.client_secret.value;
      const MODEL = 'gpt-4o-realtime-preview-2025-06-03';
      
      console.log('✅ Got ephemeral key:', EPHEMERAL_KEY.substring(0, 20) + '...');

      // 2. Create peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // 3. Set up audio
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      document.body.appendChild(audioEl);

      pc.ontrack = e => {
        console.log('🔊 Received audio track');
        audioEl.srcObject = e.streams[0];
      };

      // 4. Add microphone
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      pc.addTrack(mediaStream.getTracks()[0], mediaStream);
      console.log('🎤 Added microphone track');

      // 5. Create data channel
      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;

      dc.onopen = () => {
        console.log('✅ Data channel opened');
        setState(prev => ({ 
          ...prev, 
          isConnecting: false, 
          isConnected: true 
        }));

        // Send initial configuration
        const event = {
          type: 'session.update',
          session: {
            instructions: roleplayScenarios[scenario].instructions,
            voice: 'alloy',
            input_audio_transcription: { model: 'whisper-1' },
            turn_detection: { type: 'server_vad' },
          },
        };
        dc.send(JSON.stringify(event));
        console.log('📤 Sent session configuration');
      };

      dc.onmessage = (e) => {
        const event = JSON.parse(e.data);
        console.log('📥 Received:', event.type);

        // Handle transcripts
        if (event.type === 'conversation.item.created' && event.item) {
          const { role, content } = event.item;
          if (content && content[0]?.transcript) {
            setState(prev => ({
              ...prev,
              history: [...prev.history, {
                role,
                content: content[0].transcript,
                timestamp: new Date(),
              }],
            }));
          }
        }

        // Handle errors
        if (event.type === 'error') {
          console.error('❌ Server error:', event.error);
        }
      };

      // 6. Create and set local description
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 7. Send offer to get answer
      console.log('📤 Sending offer to OpenAI...');
      const baseUrl = 'https://api.openai.com/v1/realtime';
      const response = await fetch(`${baseUrl}?model=${MODEL}`, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          'Content-Type': 'application/sdp'
        },
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('❌ Failed to get answer:', response.status, error);
        throw new Error(`WebRTC setup failed: ${response.status}`);
      }

      const answerSdp = await response.text();
      const answer = { type: 'answer' as RTCSdpType, sdp: answerSdp };
      await pc.setRemoteDescription(answer);

      console.log('✅ WebRTC connection established!');

    } catch (error) {
      console.error('❌ Connection failed:', error);
      setState(prev => ({ 
        ...prev, 
        isConnecting: false, 
        error: error instanceof Error ? error.message : 'Connection failed' 
      }));
    }
  }, []);

  const disconnect = useCallback(() => {
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    setState(prev => ({ 
      ...prev, 
      isConnected: false,
      scenario: null,
      history: [],
    }));
  }, []);

  const toggleMute = useCallback(() => {
    setState(prev => ({ ...prev, isMuted: !prev.isMuted }));
    // ミュート実装は省略
  }, []);

  return { state, connect, disconnect, toggleMute };
}