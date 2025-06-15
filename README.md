# 日本語ロールプレイ練習アプリ

日本語学習者向けのAI音声会話練習アプリです。OpenAIの最新Voice Agents SDK（@openai/agents-realtime）を使用し、WebRTC経由でリアルタイム音声会話を実現しています。

## 機能

- 4つのロールプレイシナリオ
  - レストラン（注文練習）
  - カスタマーサポート（電話対応練習）
  - 道案内（道を尋ねる・教える練習）
  - 買い物（店員との会話練習）
- リアルタイム音声会話（WebRTC）
- 会話履歴の表示
- ミュート機能

## セットアップ

1. OpenAI APIキーを取得
2. 依存関係をインストール
   ```bash
   npm install
   ```
3. 環境変数を設定
   ```bash
   # .env.localファイルを編集
   OPENAI_API_KEY=your_openai_api_key_here
   ```

## 開発

```bash
npm run dev
```

http://localhost:3000 でアプリが起動します。

## デプロイ

Vercelへのデプロイ:
1. Vercelにプロジェクトをインポート
2. 環境変数 `OPENAI_API_KEY` を設定
3. デプロイ

## 技術スタック

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- OpenAI Voice Agents SDK (@openai/agents-realtime)
- WebRTC