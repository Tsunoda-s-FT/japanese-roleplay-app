'use client';

import { useEffect, useState } from 'react';

export function AudioDebug() {
  const [audioLevel, setAudioLevel] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    // 音声要素を監視
    const checkAudio = setInterval(() => {
      const audioElements = document.querySelectorAll('audio');
      audioElements.forEach((audio, index) => {
        if (audio.srcObject) {
          const stream = audio.srcObject as MediaStream;
          const audioContext = new AudioContext();
          const analyser = audioContext.createAnalyser();
          const source = audioContext.createMediaStreamSource(stream);
          source.connect(analyser);
          
          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
          
          setAudioLevel(average);
          setIsPlaying(!audio.paused);
          
          console.log(`🎵 Audio ${index}: playing=${!audio.paused}, volume=${audio.volume}, level=${average}`);
        }
      });
    }, 1000);

    return () => clearInterval(checkAudio);
  }, []);

  return (
    <div className="fixed top-4 right-4 bg-black text-white p-4 rounded-lg text-xs">
      <h3 className="font-bold mb-2">Audio Debug</h3>
      <div>Status: {isPlaying ? '▶️ Playing' : '⏸️ Paused'}</div>
      <div>Level: {Math.round(audioLevel)}</div>
      <div className="w-full bg-gray-700 h-2 mt-2">
        <div 
          className="bg-green-500 h-full transition-all"
          style={{ width: `${Math.min(100, audioLevel)}%` }}
        />
      </div>
    </div>
  );
}