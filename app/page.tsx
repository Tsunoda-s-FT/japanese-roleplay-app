'use client';

import { useState } from 'react';
import { useRealtimeSession } from '@/hooks/useRealtimeSession';
import { roleplayScenarios, ScenarioKey } from '@/lib/agents/roleplayAgent';

export default function Home() {
  const { state, connect, disconnect, toggleMute } = useRealtimeSession();
  const [selectedScenario, setSelectedScenario] = useState<ScenarioKey | null>(null);

  const handleScenarioSelect = (scenario: ScenarioKey) => {
    setSelectedScenario(scenario);
    connect(scenario);
  };

  const handleDisconnect = () => {
    disconnect();
    setSelectedScenario(null);
  };

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto">
      <h1 className="text-4xl font-bold text-center mb-8">
        日本語ロールプレイ練習
      </h1>

      {!state.isConnected && !state.isConnecting && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(roleplayScenarios).map(([key, scenario]) => (
            <button
              key={key}
              onClick={() => handleScenarioSelect(key as ScenarioKey)}
              className="p-6 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors"
            >
              <h3 className="text-xl font-bold mb-2">{scenario.name}</h3>
              <p className="text-gray-600">{scenario.description}</p>
            </button>
          ))}
        </div>
      )}

      {state.isConnecting && (
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          <p className="mt-4">接続中...</p>
        </div>
      )}

      {state.isConnected && selectedScenario && (
        <div className="space-y-6">
          <div className="bg-blue-100 p-4 rounded-lg">
            <h2 className="text-xl font-bold mb-2">
              {roleplayScenarios[selectedScenario].name}
            </h2>
            <p className="text-gray-700">
              {roleplayScenarios[selectedScenario].description}
            </p>
          </div>

          <div className="flex justify-center space-x-4">
            <button
              onClick={toggleMute}
              className={`px-6 py-3 rounded-lg font-medium ${
                state.isMuted
                  ? 'bg-red-500 text-white'
                  : 'bg-green-500 text-white'
              }`}
            >
              {state.isMuted ? 'ミュート中' : '話す'}
            </button>
            <button
              onClick={handleDisconnect}
              className="px-6 py-3 bg-gray-500 text-white rounded-lg font-medium"
            >
              終了
            </button>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <h3 className="font-bold mb-4">会話履歴</h3>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {state.history.length === 0 ? (
                <p className="text-gray-500">会話を始めてください...</p>
              ) : (
                state.history.map((item, index) => (
                  <div
                    key={index}
                    className={`p-3 rounded-lg ${
                      item.role === 'user'
                        ? 'bg-blue-100 ml-8'
                        : 'bg-white mr-8'
                    }`}
                  >
                    <p className="font-semibold">
                      {item.role === 'user' ? 'あなた' : 'AI'}
                    </p>
                    <p>{item.content}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {state.error && (
        <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
          <p className="font-bold">エラー</p>
          <p>{state.error}</p>
        </div>
      )}
    </main>
  );
}