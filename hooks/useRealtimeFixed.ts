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

export function useRealtimeFixed() {
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
    console.log('🔵 接続開始:', scenario);
    setState(prev => ({ ...prev, isConnecting: true, error: null, scenario }));

    try {
      // 時刻の確認
      const currentTime = Date.now();
      console.log('⏰ 現在のシステム時刻:', new Date(currentTime).toISOString());
      console.log('⏰ Unix timestamp:', Math.floor(currentTime / 1000));

      // エフェメラルキーを取得
      console.log('🔑 エフェメラルキーを取得中...');
      const tokenResponse = await fetch('/api/session');
      
      if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        throw new Error(`Token fetch failed: ${error}`);
      }

      const sessionData = await tokenResponse.json();
      const ephemeralKey = sessionData.client_secret.value;
      const expiresAt = sessionData.client_secret.expires_at;
      
      console.log('✅ エフェメラルキー取得成功');
      console.log('🔑 Key:', ephemeralKey.substring(0, 20) + '...');
      console.log('⏰ 有効期限 (Unix):', expiresAt);
      console.log('⏰ 有効期限 (JST):', new Date(expiresAt * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }));
      
      // 有効期限チェック
      const currentUnixTime = Math.floor(Date.now() / 1000);
      const timeUntilExpiry = expiresAt - currentUnixTime;
      console.log('⏱️ 有効期限まで:', timeUntilExpiry, '秒');
      
      if (timeUntilExpiry <= 0) {
        console.error('❌ トークンが既に期限切れです！');
        console.error('❌ システム時刻を確認してください');
        throw new Error('エフェメラルキーが期限切れです。システム時刻を確認してください。');
      }

      // RTCPeerConnection作成
      console.log('🔗 WebRTC接続を準備中...');
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      pcRef.current = pc;

      // 音声出力設定
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      document.body.appendChild(audioEl);
      audioRef.current = audioEl;

      pc.ontrack = (event) => {
        console.log('🔊 音声トラック受信');
        audioEl.srcObject = event.streams[0];
      };

      // マイク設定
      console.log('🎤 マイクアクセスを要求中...');
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
      console.log('✅ マイク追加完了');

      // データチャネル作成
      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;

      dc.onopen = () => {
        console.log('📡 データチャネル開通');
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
        dc.send(JSON.stringify(sessionConfig));
        console.log('📤 セッション設定送信完了');
      };

      dc.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📥 メッセージ受信:', data.type);

          if (data.type === 'conversation.item.created' && data.item) {
            const { role, content } = data.item;
            if (content && content[0]) {
              const text = content[0].transcript || content[0].text || '';
              if (text) {
                setState(prev => ({
                  ...prev,
                  history: [...prev.history, {
                    role,
                    content: text,
                    timestamp: new Date(),
                  }],
                }));
              }
            }
          }

          if (data.type === 'error') {
            console.error('❌ サーバーエラー:', data.error);
            setState(prev => ({ 
              ...prev, 
              error: data.error?.message || 'サーバーエラー' 
            }));
          }
        } catch (error) {
          console.error('❌ メッセージパースエラー:', error);
        }
      };

      // SDP offer作成
      console.log('📤 WebRTC offer作成中...');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // OpenAI APIに接続
      const model = 'gpt-4o-realtime-preview-2025-06-03';
      const url = `https://api.openai.com/v1/realtime?model=${model}`;
      
      console.log('🌐 接続先:', url);
      console.log('⏱️ リクエスト送信時刻:', new Date().toISOString());
      
      const response = await fetch(url, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          'Authorization': `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp',
        },
      });

      console.log('📨 レスポンスステータス:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ WebRTC接続エラー:', errorText);
        
        // エラーの詳細を解析
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.error?.message === 'Ephemeral token expired') {
            const suggestion = `
システム時刻を確認してください：
1. ターミナルで: date
2. 正しい時刻に設定: sudo sntp -sS time.apple.com
3. または、システム環境設定 > 日付と時刻 で「日付と時刻を自動的に設定」をオン
            `;
            throw new Error('エフェメラルキーが期限切れです。' + suggestion);
          }
        } catch (e) {
          // JSON parse error - ignore
        }
        
        throw new Error(`WebRTC接続失敗: ${response.status} - ${errorText}`);
      }

      // SDP answer受信
      const answerSdp = await response.text();
      const answer = { 
        type: 'answer' as RTCSdpType, 
        sdp: answerSdp 
      };
      
      await pc.setRemoteDescription(answer);
      console.log('✅ WebRTC接続確立！');

    } catch (error) {
      console.error('❌ 接続エラー:', error);
      setState(prev => ({ 
        ...prev, 
        isConnecting: false, 
        error: error instanceof Error ? error.message : '接続に失敗しました' 
      }));
      
      // クリーンアップ
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
    console.log('🔴 切断処理開始');
    
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
        console.log(newMuted ? '🔇 ミュート' : '🔊 ミュート解除');
      }
    }
  }, [state.isMuted]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return { state, connect, disconnect, toggleMute };
}