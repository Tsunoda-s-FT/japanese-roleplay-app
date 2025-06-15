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

// 本番用：エフェメラルトークンを使用
export function useRealtimeFinal() {
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
    console.log('🔵 Starting connection for scenario:', scenario);
    setState(prev => ({ ...prev, isConnecting: true, error: null, scenario }));

    try {
      // エフェメラルトークンを取得
      console.log('📥 Fetching ephemeral token...');
      const tokenResponse = await fetch('/api/session');
      
      if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        throw new Error(`Failed to get token: ${error}`);
      }

      const sessionData = await tokenResponse.json();
      console.log('📦 Session data received');
      
      // トークンの形式を確認
      let ephemeralKey: string;
      if (sessionData.client_secret?.value) {
        ephemeralKey = sessionData.client_secret.value;
      } else if (typeof sessionData.client_secret === 'string') {
        ephemeralKey = sessionData.client_secret;
      } else {
        throw new Error('Invalid token format received from server');
      }
      
      console.log('🔑 Ephemeral key:', ephemeralKey.substring(0, 20) + '...');

      // RTCPeerConnection作成（DirectAPIと同じ設定）
      console.log('🔗 Creating RTCPeerConnection...');
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      pcRef.current = pc;

      // ICE候補収集の完了を待つ
      const iceGatheringComplete = new Promise<void>((resolve) => {
        pc.onicegatheringstatechange = () => {
          console.log('🧊 ICE gathering state:', pc.iceGatheringState);
          if (pc.iceGatheringState === 'complete') {
            resolve();
          }
        };
      });

      // 音声出力設定
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);
      audioRef.current = audioEl;

      pc.ontrack = (event) => {
        console.log('🔊 Received audio track');
        audioEl.srcObject = event.streams[0];
      };

      // マイク設定
      console.log('🎤 Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        } 
      });
      streamRef.current = stream;
      
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });
      console.log('✅ Microphone added');

      // データチャネル作成
      const dc = pc.createDataChannel('oai-events', {
        ordered: true,
      });
      dcRef.current = dc;

      // データチャネルイベント（DirectAPIと同じ）
      dc.onopen = () => {
        console.log('✅ Data channel opened');
        setState(prev => ({ 
          ...prev, 
          isConnecting: false, 
          isConnected: true 
        }));

        // セッション設定を送信
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
              silence_duration_ms: 200,
            },
          },
        };
        console.log('📤 Sending session config');
        dc.send(JSON.stringify(sessionConfig));
      };

      dc.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📥 Received:', data.type);

          switch (data.type) {
            case 'session.created':
              console.log('✅ Session created');
              break;
              
            case 'session.updated':
              console.log('✅ Session updated');
              break;

            case 'conversation.item.created':
              if (data.item && data.item.type === 'message') {
                const content = data.item.content?.[0];
                const text = content?.transcript || content?.text || '';
                if (text) {
                  setState(prev => ({
                    ...prev,
                    history: [...prev.history, {
                      role: data.item.role,
                      content: text,
                      timestamp: new Date(),
                    }],
                  }));
                }
              }
              break;

            case 'input_audio_transcription.completed':
              if (data.transcript) {
                setState(prev => ({
                  ...prev,
                  history: [...prev.history, {
                    role: 'user',
                    content: data.transcript,
                    timestamp: new Date(),
                  }],
                }));
              }
              break;

            case 'response.text.delta':
            case 'response.audio_transcript.delta':
              // デルタ更新は一旦無視
              break;

            case 'response.text.done':
            case 'response.audio_transcript.done':
              if (data.text || data.transcript) {
                const text = data.text || data.transcript;
                setState(prev => ({
                  ...prev,
                  history: [...prev.history, {
                    role: 'assistant',
                    content: text,
                    timestamp: new Date(),
                  }],
                }));
              }
              break;

            case 'error':
              console.error('❌ Server error:', data.error);
              setState(prev => ({ 
                ...prev, 
                error: data.error?.message || 'Server error' 
              }));
              break;
          }
        } catch (error) {
          console.error('❌ Failed to parse message:', error);
        }
      };

      // SDP offer作成
      console.log('📤 Creating SDP offer...');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // ICE候補収集を待つ
      console.log('⏳ Waiting for ICE gathering...');
      await Promise.race([
        iceGatheringComplete,
        new Promise(resolve => setTimeout(resolve, 3000))
      ]);

      const finalOffer = pc.localDescription;
      if (!finalOffer || !finalOffer.sdp) {
        throw new Error('Failed to create SDP offer');
      }

      console.log('📋 SDP offer ready');

      // モデルをURLパラメータとして設定（DirectAPIで成功した方法）
      const model = 'gpt-4o-realtime-preview-2025-06-03';
      const url = new URL('https://api.openai.com/v1/realtime');
      url.searchParams.set('model', model);
      
      console.log('🌐 Connecting to:', url.toString());
      
      // エフェメラルトークンで接続
      const response = await fetch(url, {
        method: 'POST',
        body: finalOffer.sdp,
        headers: {
          'Authorization': `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp',
        },
      });

      console.log('📨 Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ API Error:', errorText);
        
        // エラー詳細の解析
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error?.message === 'Ephemeral token expired') {
            throw new Error('エフェメラルトークンが期限切れです。再度接続してください。');
          }
          throw new Error(`API Error: ${errorData.error?.message || errorText}`);
        } catch (e) {
          throw new Error(`API Error: ${response.status} - ${errorText}`);
        }
      }

      // SDP answer受信
      const answerSdp = await response.text();
      console.log('📥 Received SDP answer');
      
      const answer = { 
        type: 'answer' as RTCSdpType, 
        sdp: answerSdp 
      };
      
      await pc.setRemoteDescription(answer);
      console.log('✅ WebRTC connection established!');

    } catch (error) {
      console.error('❌ Connection error:', error);
      setState(prev => ({ 
        ...prev, 
        isConnecting: false, 
        error: error instanceof Error ? error.message : 'Connection failed' 
      }));
      
      // Cleanup
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
    console.log('🔴 Disconnecting...');
    
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
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
        console.log(newMuted ? '🔇 Muted' : '🔊 Unmuted');
      }
    }
  }, [state.isMuted]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return { state, connect, disconnect, toggleMute };
}