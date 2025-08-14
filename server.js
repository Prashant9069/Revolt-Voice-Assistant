// server.js - Complete Revolt Motors Voice Chatbot Server
const express = require('express');
const { WebSocketServer } = require('ws');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Middleware
app.use(express.static('public'));
app.use(express.json());

// System instructions for Revolt Motors
const SYSTEM_INSTRUCTIONS = `You are Rev, the friendly AI assistant for Revolt Motors, India's leading electric motorcycle company. 

Key information about Revolt Motors:
- We make electric motorcycles including the RV400 (AI-enabled flagship), RV1 (commuter bike), and RV BlazeX
- Prices start from ₹94,983 for the RV1
- Available in 25+ cities across India
- Our mission is clean, accessible commuting with next-gen mobility solutions
- We offer features like AI integration, impressive range, speed, and eco-friendly rides
- Booking starts at just ₹499

Guidelines:
- Always stay on topic about Revolt Motors, electric bikes, sustainability, and related automotive topics
- Be enthusiastic about the electric revolution and sustainable mobility
- If asked about competitors or unrelated topics, politely redirect to Revolt Motors
- Provide helpful information about our bikes, features, pricing, and availability
- Keep responses conversational and engaging
- If you don't know specific technical details, suggest visiting revoltmotors.com or contacting our sales team
- Keep responses under 30 seconds when speaking
- Be friendly and professional`;

class GeminiLiveClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.clientWs = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
    }

    async connect(clientWs) {
        try {
            const apiKey = process.env.GEMINI_API_KEY;
            if (!apiKey) {
                throw new Error('GEMINI_API_KEY not found in environment variables');
            }

            if (!apiKey.startsWith('AI')) {
                throw new Error('Invalid GEMINI_API_KEY format - should start with "AI"');
            }

            console.log('🔑 API Key found:', apiKey.substring(0, 10) + '...');

            const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash-live-001';
            const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;

            console.log('🌐 Connecting to Gemini Live API...');
            console.log('📱 Model:', model);

            this.ws = new WebSocket(url);
            this.clientWs = clientWs;

            this.ws.on('open', () => {
                console.log('✅ Connected to Gemini Live API');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.setupSession(model);
            });

            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data);
                    console.log('📥 Received from Gemini:', JSON.stringify(message, null, 2));
                    this.handleGeminiMessage(message);
                } catch (error) {
                    console.error('❌ Error parsing Gemini message:', error);
                    this.sendError('Failed to parse AI response');
                }
            });

            this.ws.on('error', (error) => {
                console.error('❌ Gemini WebSocket error:', error);
                
                let errorMessage = 'Connection to AI service failed';
                if (error.message) {
                    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
                        errorMessage = 'Invalid API key - check your GEMINI_API_KEY';
                    } else if (error.message.includes('403')) {
                        errorMessage = 'API access denied - check permissions';
                    } else if (error.message.includes('429')) {
                        errorMessage = 'Rate limit exceeded - please wait';
                    } else if (error.message.includes('500')) {
                        errorMessage = 'AI service temporarily unavailable';
                    }
                }
                
                this.sendError(errorMessage);
            });

            this.ws.on('close', (code, reason) => {
                console.log('🔌 Disconnected from Gemini Live API');
                console.log('📊 Close code:', code, 'Reason:', reason.toString());
                this.isConnected = false;
                
                if (code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
                    console.log(`🔄 Attempting reconnect ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts}`);
                    this.reconnectAttempts++;
                    setTimeout(() => this.connect(this.clientWs), 2000);
                } else {
                    this.sendError(`Connection closed: ${code} ${reason.toString()}`);
                }
            });

        } catch (error) {
            console.error('❌ Failed to connect to Gemini:', error);
            this.sendError(`Connection error: ${error.message}`);
            throw error;
        }
    }

    setupSession(model) {
        const setupMessage = {
            setup: {
                model: `models/${model}`,
                generation_config: {
                    response_modalities: ["AUDIO"],
                    speech_config: {
                        voice_config: {
                            prebuilt_voice_config: {
                                voice_name: "Aoede" // Female voice
                            }
                        }
                    },
                    temperature: 0.7,
                    max_output_tokens: 1024
                },
                system_instruction: {
                    parts: [{
                        text: SYSTEM_INSTRUCTIONS
                    }]
                }
            }
        };

        console.log('📤 Setting up session with model:', model);
        console.log('📄 Setup message:', JSON.stringify(setupMessage, null, 2));
        
        try {
            this.ws.send(JSON.stringify(setupMessage));
        } catch (error) {
            console.error('❌ Error sending setup message:', error);
            this.sendError('Failed to setup AI session');
        }
    }

    handleGeminiMessage(message) {
        try {
            if (message.setup_complete) {
                console.log('✅ Gemini setup complete');
                this.clientWs.send(JSON.stringify({ 
                    type: 'ready',
                    message: 'AI assistant is ready to chat!'
                }));
                return;
            }

            if (message.server_content) {
                const content = message.server_content;
                
                // Handle audio response
                if (content.model_turn && content.model_turn.parts) {
                    for (const part of content.model_turn.parts) {
                        if (part.inline_data && part.inline_data.mime_type === 'audio/pcm') {
                            console.log('🔊 Sending audio to client, size:', part.inline_data.data.length);
                            this.clientWs.send(JSON.stringify({
                                type: 'audio',
                                data: part.inline_data.data
                            }));
                        }
                    }
                }

                // Handle turn complete
                if (content.turn_complete) {
                    console.log('✅ Turn complete');
                    this.clientWs.send(JSON.stringify({
                        type: 'turn_complete'
                    }));
                }
            }

            // Handle interruption
            if (message.server_content && message.server_content.interrupted) {
                console.log('⚠️ Turn interrupted');
                this.clientWs.send(JSON.stringify({
                    type: 'interrupted'
                }));
            }

            // Handle errors from Gemini
            if (message.error) {
                console.error('❌ Gemini API error:', message.error);
                this.sendError(`AI Error: ${message.error.message || 'Unknown error'}`);
            }

        } catch (error) {
            console.error('❌ Error handling Gemini message:', error);
            this.sendError('Failed to process AI response');
        }
    }

    sendAudio(audioData) {
        if (!this.isConnected || !this.ws) {
            console.error('❌ Not connected to Gemini');
            this.sendError('Not connected to AI service');
            return;
        }

        if (!audioData || audioData.length === 0) {
            console.error('❌ No audio data to send');
            this.sendError('No audio data received');
            return;
        }

        const message = {
            client_content: {
                turns: [{
                    role: "user",
                    parts: [{
                        inline_data: {
                            mime_type: "audio/webm",
                            data: audioData
                        }
                    }]
                }],
                turn_complete: true
            }
        };

        console.log('📤 Sending audio to Gemini, size:', audioData.length);
        
        try {
            this.ws.send(JSON.stringify(message));
            console.log('✅ Audio sent successfully');
        } catch (error) {
            console.error('❌ Error sending audio:', error);
            this.sendError('Failed to send audio to AI');
        }
    }

    sendError(message) {
        if (this.clientWs && this.clientWs.readyState === WebSocket.OPEN) {
            this.clientWs.send(JSON.stringify({
                type: 'error',
                message: message
            }));
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
        this.isConnected = false;
    }
}

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('👤 Client connected from:', ws._socket.remoteAddress);
    
    const geminiClient = new GeminiLiveClient();
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📥 Client message type:', data.type);
            
            switch (data.type) {
                case 'start_session':
                    console.log('🚀 Starting new session...');
                    await geminiClient.connect(ws);
                    break;
                    
                case 'audio_data':
                    console.log('🎵 Received audio data, size:', data.audio?.length || 0);
                    if (!data.audio || data.audio.length === 0) {
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            message: 'No audio data received' 
                        }));
                        return;
                    }
                    geminiClient.sendAudio(data.audio);
                    break;
                    
                case 'end_session':
                    console.log('🛑 Ending session...');
                    geminiClient.disconnect();
                    break;
                    
                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;
                    
                default:
                    console.log('❓ Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('❌ Error handling client message:', error);
            ws.send(JSON.stringify({ 
                type: 'error', 
                message: `Server error: ${error.message}` 
            }));
        }
    });

    ws.on('close', (code, reason) => {
        console.log('👤 Client disconnected:', code, reason?.toString());
        geminiClient.disconnect();
    });

    ws.on('error', (error) => {
        console.error('❌ Client WebSocket error:', error);
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        apiKeyConfigured: !!process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-live-001',
        nodeVersion: process.version
    });
});

// Debug endpoint
app.get('/debug', (req, res) => {
    res.json({
        apiKeyConfigured: !!process.env.GEMINI_API_KEY,
        apiKeyLength: process.env.GEMINI_API_KEY?.length || 0,
        apiKeyPrefix: process.env.GEMINI_API_KEY?.substring(0, 5) || 'None',
        model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-live-001',
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'development',
        port: process.env.PORT || 3000
    });
});

// Serve the main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Express error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

// Enhanced startup with validation
async function startServer() {
    console.log('🚀 Starting Revolt Motors Voice Chatbot...');
    
    // Validate environment
    if (!process.env.GEMINI_API_KEY) {
        console.error('❌ GEMINI_API_KEY is not set in .env file');
        console.log('📝 Please create a .env file with your Gemini API key');
        console.log('🔗 Get your key from: https://aistudio.google.com/');
        process.exit(1);
    }

    if (!process.env.GEMINI_API_KEY.startsWith('AI')) {
        console.error('❌ GEMINI_API_KEY appears to be invalid (should start with "AI")');
        console.log('🔗 Get a new key from: https://aistudio.google.com/');
        process.exit(1);
    }

    // Check if public directory exists
    const publicDir = path.join(__dirname, 'public');
    const fs = require('fs');
    if (!fs.existsSync(publicDir)) {
        console.error('❌ Public directory not found');
        console.log('📁 Please create a "public" folder and place index.html inside it');
        process.exit(1);
    }

    server.listen(PORT, () => {
        console.log('🎉 Server running successfully!');
        console.log(`🌐 Main app: http://localhost:${PORT}`);
        console.log(`🔍 Debug info: http://localhost:${PORT}/debug`);
        console.log(`💚 Health check: http://localhost:${PORT}/health`);
        console.log(`🔑 API Key: ${process.env.GEMINI_API_KEY.substring(0, 10)}...`);
        console.log('📁 Serving files from: public/');
        console.log('');
        console.log('🎤 Ready for voice chat! Open the URL above in your browser.');
    });
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    server.close(() => {
        console.log('✅ Server stopped');
        process.exit(0);
    });
});

startServer();

module.exports = { app, server };