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

export function useRealtimeWebRTC() {
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const connect = useCallback(async (scenario: ScenarioKey) => {
    setState(prev => ({ ...prev, isConnecting: true, error: null, scenario }));

    try {
      // Get ephemeral key from server
      const tokenResponse = await fetch('/api/session');
      if (!tokenResponse.ok) {
        throw new Error('Failed to get session token');
      }
      
      const data = await tokenResponse.json();
      const ephemeralKey = data.client_secret.value;
      console.log('Got ephemeral key:', ephemeralKey.substring(0, 10) + '...');

      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } 
      });
      streamRef.current = stream;

      // Create peer connection
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      pcRef.current = pc;

      // Add audio track
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      // Create audio element for playback
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audioRef.current = audio;

      // Handle incoming audio
      pc.ontrack = (event) => {
        console.log('Received remote track');
        audio.srcObject = event.streams[0];
      };

      // Create data channel
      const dc = pc.createDataChannel('oai-events', { ordered: true });
      dcRef.current = dc;

      dc.onopen = () => {
        console.log('DataChannel opened');
        setState(prev => ({ 
          ...prev, 
          isConnecting: false, 
          isConnected: true 
        }));

        // Send session configuration
        const sessionConfig = {
          type: 'session.update',
          session: {
            instructions: roleplayScenarios[scenario].instructions,
            voice: 'alloy',
            input_audio_transcription: {
              model: 'whisper-1'
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 200
            }
          }
        };
        dc.send(JSON.stringify(sessionConfig));
      };

      dc.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('Received message:', message.type);

          // Handle different message types
          if (message.type === 'conversation.item.completed') {
            const { item } = message;
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
          } else if (message.type === 'input_audio_transcription.completed') {
            const { transcript } = message;
            if (transcript) {
              setState(prev => ({
                ...prev,
                history: [...prev.history, {
                  role: 'user',
                  content: transcript,
                  timestamp: new Date(),
                }],
              }));
            }
          } else if (message.type === 'error') {
            console.error('Server error:', message.error);
            setState(prev => ({ 
              ...prev, 
              error: message.error?.message || 'Server error' 
            }));
          }
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      };

      dc.onerror = (error) => {
        console.error('DataChannel error:', error);
        setState(prev => ({ 
          ...prev, 
          error: 'Connection error' 
        }));
      };

      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Send offer to OpenAI
      const sdpResponse = await fetch('https://api.openai.com/v1/realtime', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      });

      if (!sdpResponse.ok) {
        const errorText = await sdpResponse.text();
        console.error('SDP response error:', sdpResponse.status, errorText);
        throw new Error(`Failed to establish WebRTC connection: ${sdpResponse.status}`);
      }

      const answer = {
        type: 'answer' as RTCSdpType,
        sdp: await sdpResponse.text(),
      };

      await pc.setRemoteDescription(answer);
      console.log('WebRTC connection established');

    } catch (error) {
      console.error('Connection error:', error);
      setState(prev => ({ 
        ...prev, 
        isConnecting: false, 
        error: error instanceof Error ? error.message : 'Failed to connect' 
      }));
      
      // Cleanup on error
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    }
  }, []);

  const disconnect = useCallback(() => {
    // Close data channel
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }

    // Close peer connection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    // Stop media stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Remove audio element
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current = null;
    }

    setState(prev => ({ 
      ...prev, 
      isConnected: false,
      scenario: null,
      history: [],
    }));
  }, []);

  const toggleMute = useCallback(() => {
    if (streamRef.current) {
      const audioTrack = streamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        const newMuted = !state.isMuted;
        audioTrack.enabled = !newMuted;
        setState(prev => ({ ...prev, isMuted: newMuted }));

        // Send interrupt if muting while speaking
        if (newMuted && dcRef.current && dcRef.current.readyState === 'open') {
          dcRef.current.send(JSON.stringify({
            type: 'input_audio_buffer.clear'
          }));
        }
      }
    }
  }, [state.isMuted]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    state,
    connect,
    disconnect,
    toggleMute,
  };
}