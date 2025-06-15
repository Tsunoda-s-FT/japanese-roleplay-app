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

// デバッグ用：APIキーを直接使用（本番環境では使用しないでください）
export function useRealtimeDirectAPI() {
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
    console.log('🔵 === Direct API Connection Test ===');
    setState(prev => ({ ...prev, isConnecting: true, error: null, scenario }));

    try {
      // APIキーを環境変数から取得（開発用）
      const apiKey = process.env.NEXT_PUBLIC_OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('NEXT_PUBLIC_OPENAI_API_KEY is not set in .env.local');
      }
      
      console.log('🔑 Using direct API key (first 20 chars):', apiKey.substring(0, 20) + '...');

      // RTCPeerConnection作成
      console.log('🔗 Creating RTCPeerConnection...');
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      pcRef.current = pc;

      // ICE候補収集の完了を待つためのPromise
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
        console.log('🔊 Received audio track:', event.track.kind);
        if (event.track.kind === 'audio') {
          audioEl.srcObject = event.streams[0];
          // 音量を確認
          audioEl.volume = 1.0;
          audioEl.play().then(() => {
            console.log('🔊 Audio playback started');
          }).catch(err => {
            console.error('❌ Audio playback error:', err);
          });
        }
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

      // データチャネル作成（名前は正確に 'oai-events'）
      const dc = pc.createDataChannel('oai-events', {
        ordered: true,
      });
      dcRef.current = dc;

      // データチャネルのイベント設定
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
            modalities: ['text', 'audio'],
            instructions: roleplayScenarios[scenario].instructions,
            voice: 'alloy',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
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
        console.log('📤 Sending session config:', sessionConfig);
        dc.send(JSON.stringify(sessionConfig));
        
        // 初回メッセージを送信して会話を開始
        setTimeout(() => {
          console.log('👋 Sending initial greeting...');
          const initialMessage = {
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [{
                type: 'input_text',
                text: 'こんにちは'
              }]
            }
          };
          dc.send(JSON.stringify(initialMessage));
          
          // 応答を生成
          dc.send(JSON.stringify({ type: 'response.create' }));
        }, 1000);
      };

      dc.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📥 Received:', data.type, data);

          // メッセージタイプごとの処理
          switch (data.type) {
            case 'session.created':
              console.log('✅ Session created');
              break;
              
            case 'session.updated':
              console.log('✅ Session updated');
              break;

            case 'conversation.item.created':
              console.log('💬 Conversation item:', data.item);
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
              console.log('🎤 User said:', data.transcript);
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

            case 'response.audio.delta':
              console.log('🔊 Audio delta received');
              break;

            case 'response.audio.done':
              console.log('🔊 Audio response complete');
              break;

            case 'response.text.delta':
              // テキストのデルタ更新
              break;

            case 'response.text.done':
              console.log('📝 Text response:', data.text);
              if (data.text) {
                setState(prev => ({
                  ...prev,
                  history: [...prev.history, {
                    role: 'assistant',
                    content: data.text,
                    timestamp: new Date(),
                  }],
                }));
              }
              break;

            case 'response.audio_transcript.done':
              console.log('📝 Audio transcript:', data.transcript);
              if (data.transcript) {
                setState(prev => ({
                  ...prev,
                  history: [...prev.history, {
                    role: 'assistant',
                    content: data.transcript,
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

            default:
              console.log('📥 Other event:', data.type, data);
          }
        } catch (error) {
          console.error('❌ Failed to parse message:', error);
        }
      };

      dc.onerror = (error) => {
        console.error('❌ Data channel error:', error);
      };

      // SDP offer作成
      console.log('📤 Creating SDP offer...');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // ICE候補収集が完了するまで待つ（最大3秒）
      console.log('⏳ Waiting for ICE gathering...');
      await Promise.race([
        iceGatheringComplete,
        new Promise(resolve => setTimeout(resolve, 3000))
      ]);

      // 最終的なSDP
      const finalOffer = pc.localDescription;
      if (!finalOffer || !finalOffer.sdp) {
        throw new Error('Failed to create SDP offer');
      }

      console.log('📋 SDP offer ready, length:', finalOffer.sdp.length);

      // モデルを正しく指定する方法を試す
      const model = 'gpt-4o-realtime-preview-2025-06-03';
      
      // 方法1: URLパラメータとして追加
      const url = new URL('https://api.openai.com/v1/realtime');
      url.searchParams.set('model', model);
      
      console.log('🌐 Connecting to:', url.toString());
      console.log('🔐 Using API key starting with:', apiKey.substring(0, 20));
      
      const response = await fetch(url, {
        method: 'POST',
        body: finalOffer.sdp,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/sdp',
        },
      });

      console.log('📨 Response status:', response.status);
      console.log('📨 Response headers:', Object.fromEntries(response.headers.entries()));

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ API Error:', errorText);
        
        // エラーの詳細解析
        try {
          const errorData = JSON.parse(errorText);
          console.error('❌ Parsed error:', errorData);
          
          if (errorData.error?.code === 'invalid_api_key') {
            throw new Error('APIキーが無効です。.env.localのNEXT_PUBLIC_OPENAI_API_KEYを確認してください。');
          }
        } catch (e) {
          // JSON parse error - ignore
        }
        
        throw new Error(`API Error: ${response.status} - ${errorText}`);
      }

      // SDP answer受信
      const answerSdp = await response.text();
      console.log('📥 Received SDP answer, length:', answerSdp.length);
      
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
        
        // ミュート状態の変更を通知
        if (dcRef.current && dcRef.current.readyState === 'open') {
          if (newMuted) {
            // ミュート時は音声入力をクリア
            dcRef.current.send(JSON.stringify({
              type: 'input_audio_buffer.clear'
            }));
          }
        }
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