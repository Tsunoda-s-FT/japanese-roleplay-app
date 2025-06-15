'use client';

export function DebugPanel() {
  return (
    <div className="fixed bottom-4 right-4 bg-gray-900 text-green-400 p-4 rounded-lg max-w-md font-mono text-xs">
      <h3 className="text-yellow-400 mb-2">Debug Console</h3>
      <div className="text-gray-400">
        Open browser DevTools (F12) to see detailed logs:
        <ul className="mt-2 space-y-1">
          <li>🔵 Connection start</li>
          <li>📡 Token fetch</li>
          <li>🔑 Ephemeral key</li>
          <li>🎤 Microphone access</li>
          <li>🔗 WebRTC connection</li>
          <li>📤 SDP offer/answer</li>
          <li>🚀 DataChannel events</li>
          <li>❌ Errors with details</li>
        </ul>
      </div>
    </div>
  );
}