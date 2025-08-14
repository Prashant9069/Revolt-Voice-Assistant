// test-api.js - Test your Gemini API key and connection
require('dotenv').config();
const WebSocket = require('ws');

async function testGeminiConnection() {
    console.log('🧪 Testing Gemini Live API Connection...\n');
    
    // Check environment variables
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash-live-001';
    
    console.log('🔍 Environment Check:');
    console.log('✓ API Key configured:', !!apiKey);
    console.log('✓ API Key length:', apiKey?.length || 0);
    console.log('✓ API Key prefix:', apiKey?.substring(0, 5) || 'None');
    console.log('✓ Model:', model);
    console.log('✓ Node version:', process.version);
    console.log('');
    
    if (!apiKey) {
        console.error('❌ GEMINI_API_KEY not found in .env file');
        console.log('📝 Create a .env file with: GEMINI_API_KEY=your_key_here');
        console.log('🔗 Get your key from: https://aistudio.google.com/');
        process.exit(1);
    }
    
    if (!apiKey.startsWith('AI')) {
        console.error('❌ Invalid API key format (should start with "AI")');
        console.log('🔗 Get a new key from: https://aistudio.google.com/');
        process.exit(1);
    }
    
    console.log('🌐 Testing WebSocket connection...');
    
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    
    const ws = new WebSocket(url);
    let testPassed = false;
    
    // Set timeout for the test
    const timeout = setTimeout(() => {
        if (!testPassed) {
            console.error('❌ Connection timeout (30 seconds)');
            ws.close();
            process.exit(1);
        }
    }, 30000);
    
    ws.on('open', () => {
        console.log('✅ Successfully connected to Gemini Live API');
        
        // Send setup message to test the connection
        const setupMessage = {
            setup: {
                model: `models/${model}`,
                generation_config: {
                    response_modalities: ["TEXT"], // Use text for testing
                    temperature: 0.7
                },
                system_instruction: {
                    parts: [{
                        text: "You are a test assistant. Respond with 'Connection test successful' when you receive this message."
                    }]
                }
            }
        };
        
        console.log('📤 Sending setup message...');
        ws.send(JSON.stringify(setupMessage));
    });
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            console.log('📥 Received message type:', Object.keys(message).join(', '));
            
            if (message.setup_complete) {
                console.log('✅ Setup completed successfully');
                
                // Send a test message
                const testMessage = {
                    client_content: {
                        turns: [{
                            role: "user",
                            parts: [{
                                text: "Hello, this is a connection test"
                            }]
                        }],
                        turn_complete: true
                    }
                };
                
                console.log('📤 Sending test message...');
                ws.send(JSON.stringify(testMessage));
            }
            
            if (message.server_content && message.server_content.model_turn) {
                console.log('✅ Received AI response - connection working!');
                const parts = message.server_content.model_turn.parts;
                if (parts && parts[0] && parts[0].text) {
                    console.log('🤖 AI Response:', parts[0].text);
                }
                testPassed = true;
                
                setTimeout(() => {
                    console.log('\n🎉 Test completed successfully!');
                    console.log('✅ Your API key is working');
                    console.log('✅ Gemini Live API is accessible');
                    console.log('✅ Your server should work fine');
                    console.log('\n🚀 You can now run: npm start');
                    clearTimeout(timeout);
                    ws.close();
                    process.exit(0);
                }, 1000);
            }
            
            if (message.error) {
                console.error('❌ API Error:', message.error);
                process.exit(1);
            }
            
        } catch (error) {
            console.error('❌ Error parsing response:', error);
            process.exit(1);
        }
    });
}