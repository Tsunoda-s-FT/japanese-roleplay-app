import { NextResponse } from 'next/server';

export async function GET() {
  console.log('🌐 === SESSION ENDPOINT CALLED ===');
  
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      console.error('❌ No API key found in environment');
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    console.log('🔐 API key found:', apiKey.substring(0, 20) + '...');
    console.log('🌐 Endpoint:', 'https://api.openai.com/v1/realtime/sessions');
    
    const requestBody = {
      model: 'gpt-4o-realtime-preview-2025-06-03',
      voice: 'alloy',
    };
    
    console.log('📤 Request body:', JSON.stringify(requestBody, null, 2));
    
    const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    console.log('📨 Response status:', response.status);
    console.log('📨 Response headers:', Object.fromEntries(response.headers.entries()));
    
    if (!response.ok) {
      const error = await response.text();
      console.error('❌ OpenAI API error:', {
        status: response.status,
        statusText: response.statusText,
        error: error,
        url: 'https://api.openai.com/v1/realtime/sessions',
        headers: {
          'Authorization': `Bearer ${apiKey.substring(0, 20)}...`,
          'Content-Type': 'application/json',
        }
      });
      
      // Try to parse error as JSON
      try {
        const errorJson = JSON.parse(error);
        console.error('❌ Parsed error:', errorJson);
      } catch (e) {
        // Not JSON
      }
      
      return NextResponse.json(
        { error: 'Failed to create session', details: error },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log('✅ Session created successfully!');
    console.log('📦 Full response:', JSON.stringify(data, null, 2));
    
    // Detailed client_secret analysis
    console.log('🔍 Client secret analysis:', {
      type: typeof data.client_secret,
      hasValue: !!data.client_secret?.value,
      valueType: typeof data.client_secret?.value,
      valueLength: data.client_secret?.value?.length,
      expiresAt: data.client_secret?.expires_at,
      expiresAtDate: data.client_secret?.expires_at ? new Date(data.client_secret.expires_at * 1000).toISOString() : 'N/A',
      model: data.model,
      voice: data.voice,
    });
    
    console.log('🚀 Returning session data to client');
    
    // Return the data as received from OpenAI
    return NextResponse.json(data);
  } catch (error) {
    console.error('❌ Session creation error:', error);
    console.error('❌ Error type:', error?.constructor?.name);
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack');
    
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}