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
      
      const sessionData = await tokenResponse.json();
      const ephemeralKey = sessionData.client_secret.value;
      const model = sessionData.model || 'gpt-4o-realtime-preview-2025-06-03';
      
      console.log('Got ephemeral key:', ephemeralKey.substring(0, 10) + '...');
      console.log('Using model:', model);

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
      document.body.appendChild(audio); // 重要: DOMに追加
      audioRef.current = audio;

      // Handle incoming audio
      pc.ontrack = (event) => {
        console.log('Received remote track');
        audio.srcObject = event.streams[0];
      };

      // Create data channel - 名前は正確に 'oai-events' である必要があります
      const dc = pc.createDataChannel('oai-events', { 
        ordered: true 
      });
      dcRef.current = dc;

      let isConnected = false;

      dc.onopen = () => {
        console.log('DataChannel opened');
        isConnected = true;
        setState(prev => ({ 
          ...prev, 
          isConnecting: false, 
          isConnected: true 
        }));

        // Send session configuration
        const sessionUpdate = {
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
        dc.send(JSON.stringify(sessionUpdate));
        console.log('Sent session update');
      };

      dc.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('Received:', message.type);

          switch (message.type) {
            case 'session.created':
              console.log('Session created successfully');
              break;
              
            case 'session.updated':
              console.log('Session updated successfully');
              break;

            case 'conversation.item.created':
              if (message.item && message.item.type === 'message') {
                const content = message.item.content?.[0]?.text || 
                               message.item.content?.[0]?.transcript || '';
                if (content && message.item.role) {
                  setState(prev => ({
                    ...prev,
                    history: [...prev.history, {
                      role: message.item.role,
                      content,
                      timestamp: new Date(),
                    }],
                  }));
                }
              }
              break;

            case 'response.audio_transcript.delta':
              // 音声の文字起こしのデルタ更新
              break;

            case 'response.audio_transcript.done':
              // 音声の文字起こし完了
              if (message.transcript) {
                setState(prev => ({
                  ...prev,
                  history: [...prev.history, {
                    role: 'assistant',
                    content: message.transcript,
                    timestamp: new Date(),
                  }],
                }));
              }
              break;

            case 'error':
              console.error('Server error:', message.error);
              setState(prev => ({ 
                ...prev, 
                error: message.error?.message || 'Server error' 
              }));
              break;
          }
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      };

      dc.onerror = (error) => {
        console.error('DataChannel error:', error);
      };

      dc.onclose = () => {
        console.log('DataChannel closed');
        if (isConnected) {
          setState(prev => ({ 
            ...prev, 
            isConnected: false 
          }));
        }
      };

      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 正しいWebRTCエンドポイントを使用
      const baseUrl = 'https://api.openai.com/v1/realtime';
      const url = `${baseUrl}?model=${model}`;
      
      console.log('Connecting to:', url);

      // Send offer to OpenAI
      const sdpResponse = await fetch(url, {
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

      const answerSdp = await sdpResponse.text();
      const answer = {
        type: 'answer' as RTCSdpType,
        sdp: answerSdp,
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
      if (audioRef.current) {
        audioRef.current.remove();
        audioRef.current = null;
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
      audioRef.current.remove();
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

        // Send interrupt if muting
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