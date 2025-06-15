import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    console.log('Creating ephemeral key with API key:', apiKey.substring(0, 10) + '...');
    
    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-realtime-preview-2025-06-03',
        voice: 'alloy',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI API error:', response.status, error);
      console.error('Request URL:', 'https://api.openai.com/v1/realtime/sessions');
      console.error('Request headers:', {
        'Authorization': `Bearer ${apiKey.substring(0, 10)}...`,
        'Content-Type': 'application/json',
      });
      return NextResponse.json(
        { error: 'Failed to create session', details: error },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('Session response:', JSON.stringify(data, null, 2));
    
    // デバッグ用：client_secretの構造を確認
    console.log('client_secret type:', typeof data.client_secret);
    console.log('client_secret value:', data.client_secret?.value ? 'has value' : 'no value');
    
    // Return the data as received from OpenAI
    return NextResponse.json(data);
  } catch (error) {
    console.error('Session creation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}