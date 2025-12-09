import React, { useState, useRef, useEffect } from 'react';
import { Message } from '../types';
import { sendMessageToGemini, ImageAttachment } from '../services/geminiService';
import { useConfig } from '../contexts/ConfigContext';
import { DEV_INFO } from '../constants';

const ChatInterface: React.FC = () => {
  const { db, currentUser, saveChatLog, fetchChatLogs, clearChatLogs } = useConfig();
  
  // FIX: Black Screen Fallback
  // Ensure we always have a config object even if currentUser is loading/null
  const globalConfig = db?.globalConfig || { aiName: 'System', aiPersona: '', devName: 'Admin', apiKeys: [], avatarUrl: '' };
  const userConfig = currentUser?.config || {};

  const config = {
    aiName: userConfig.aiName || globalConfig.aiName,
    aiPersona: userConfig.aiPersona || globalConfig.aiPersona,
    devName: userConfig.devName || globalConfig.devName,
    apiKeys: (userConfig.apiKeys && userConfig.apiKeys.length > 0) ? userConfig.apiKeys : globalConfig.apiKeys
  };
  
  const replacePlaceholders = (text: string) => {
    if (!text) return "";
    return text
      .replace(/{{AI_NAME}}/g, config.aiName)
      .replace(/{{DEV_NAME}}/g, config.devName);
  };

  const processedPersona = replacePlaceholders(config.aiPersona);
  const systemInstruction = User: ${currentUser?.username || 'Guest'}. ${processedPersona};

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedBlockIndex, setCopiedBlockIndex] = useState<number | null>(null);
  const [isProcessingImages, setIsProcessingImages] = useState(false);
  const [selectedImages, setSelectedImages] = useState<{ file: File; preview: string }[]>([]);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. Fetch History on Mount
  useEffect(() => {
    const loadHistory = async () => {
        if (currentUser) {
            const logs = await fetchChatLogs();
            if (logs.length > 0) {
                const formattedMessages: Message[] = logs.map(log => ({
                    role: log.role,
                    text: log.content
                }));
                setMessages(formattedMessages);
            } else {
                setMessages([{ role: 'model', text: Connection established. ${config.aiName} System online. Hello, ${currentUser?.username}. }]);
            }
        }
    };
    loadHistory();
  }, [currentUser]); // Dependency on currentUser ensures it runs when user data is ready

  // Scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, selectedImages]);

  // Syntax highlighting
  useEffect(() => {
    if ((window as any).Prism) setTimeout(() => (window as any).Prism.highlightAll(), 0);
  }, [messages]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setIsProcessingImages(true);
      const files = Array.from(e.target.files);
      let processed = 0;
      files.forEach((file: File) => {
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onloadend = () => {
            setSelectedImages(prev => [...prev, { file, preview: reader.result as string }]);
            processed++;
            if(processed === files.length) setIsProcessingImages(false);
          };
          reader.readAsDataURL(file);
        } else { processed++; if(processed === files.length) setIsProcessingImages(false); }
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
    });
  };

  const handleResetChat = async () => {
    try {
      await clearChatLogs();
      setMessages([{ role: 'model', text: Chat history cleared. ${config.aiName} System online. Hello, ${currentUser?.username || 'Guest'}. }]);
      setShowResetConfirm(false);
    } catch (error) {
      console.error('Failed to reset chat:', error);
      setMessages(prev => [...prev, { role: 'model', text: 'Error: Failed to reset chat.', isError: true }]);
    }
  };

  const handleSendMessage = async () => {
    // Check for reset command
    if (input.trim().toLowerCase() === 'reset') {
      setInput('');
      setShowResetConfirm(true);
      return;
    }

    if ((!input.trim() && selectedImages.length === 0) || isLoading) return;

    const currentInput = input;
    const currentImages = [...selectedImages];
    
    setInput('');
    setSelectedImages([]);
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setIsLoading(true);

    // Optimistic UI Update
    setMessages(prev => [...prev, { role: 'user', text: currentInput }]);
    
    // Save User Message to DB
    saveChatLog('user', currentInput);

    try {
      const imageAttachments: ImageAttachment[] = [];
      for (const img of currentImages) {
        const base64Data = await fileToBase64(img.file);
        imageAttachments.push({ inlineData: { data: base64Data, mimeType: img.file.type } });
      }

      const history = messages.filter(m => !m.isError).map(m => ({ role: m.role, parts: [{ text: m.text }] }));

      const responseText = await sendMessageToGemini(
        currentInput,
        imageAttachments,
        history,
        { apiKeys: config.apiKeys, systemInstruction: systemInstruction }
      );

      setMessages(prev => [...prev, { role: 'model', text: responseText }]);
      
      // Save AI Response to DB
      saveChatLog('model', responseText);

    } catch (error: any) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'model', text: Error: ${error.message}, isError: true }]);
    } finally {
      setIsLoading(false);
    }
  };

  const renderMessageContent = (text: string) => {
    const parts = [];
    const codeBlockRegex = /(\w+)?\s*([\s\S]*?)/g;
    let lastIndex = 0;
    let match;
    let blockIndex = 0;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: text.substring(lastIndex, match.index) });
      }
      parts.push({ type: 'code', language: match[1] || 'text', content: match[2].trim(), index: blockIndex++ });
      lastIndex = codeBlockRegex.lastIndex;
    }
    if (lastIndex < text.length) parts.push({ type: 'text', content: text.substring(lastIndex) });

    const escapeHtml = (str: string) => str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;").replace(/\n/g, '<br/>');

    return parts.map((part, idx) => {
      if (part.type === 'code') {
        const isCopied = copiedBlockIndex === part.index;
        return (
          <div key={idx} className="my-4 rounded-lg overflow-hidden border border-gray-700 bg-[#0d0d0d]">
            <div className="flex justify-between items-center px-4 py-2 bg-[#1a1a1a] border-b border-gray-700">
              <span className="text-xs font-mono text-gray-400 uppercase">{part.language}</span>
              <button onClick={() => { navigator.clipboard.writeText(part.content); setCopiedBlockIndex(part.index as number); setTimeout(() => setCopiedBlockIndex(null), 2000); }} className="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition-colors">
                {isCopied ? <><i className="fa-solid fa-check text-green-500"></i> Copied!</> : <><i className="fa-regular fa-copy"></i> Copy</>}
              </button>
            </div>
            <pre className={language-${part.language} !m-0 !bg-transparent p-4 overflow-x-auto}><code>{part.content}</code></pre>
          </div>
        );
      }
      return <div key={idx} className="whitespace-pre-wrap leading-relaxed" dangerouslySetInnerHTML={{ __html: escapeHtml(part.content).replace(/\\(.?)\\/g, '<strong>$1</strong>').replace(/\(.?)\/g, '<em>$1</em>') }} />;
    });
  };

  return (
    <div className="max-w-4xl mx-auto h-[600px] flex flex-col bg-black/80 backdrop-blur-sm border-2 border-red-900 rounded-lg shadow-[0_0_30px_rgba(139,0,0,0.3)] relative overflow-hidden scanlines">
      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="absolute inset-0 bg-black/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900/90 border-2 border-red-900 rounded-lg p-6 max-w-md w-full">
            <div className="flex items-center gap-3 mb-4 text-red-500">
              <i className="fa-solid fa-triangle-exclamation text-xl"></i>
              <h3 className="text-lg font-bold font-['Press_Start_2P']">RESET CHAT</h3>
            </div>
            <p className="text-gray-300 mb-6 font-['JetBrains_Mono'] text-sm">
              Are you sure you want to reset the chat? This will clear all message history and cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 bg-gray-800 border border-gray-700 text-gray-300 py-2 rounded hover:bg-gray-700 font-['Press_Start_2P'] text-xs"
              >
                CANCEL
              </button>
              <button
                onClick={handleResetChat}
                className="flex-1 bg-red-900 border border-red-700 text-white py-2 rounded hover:bg-red-800 font-['Press_Start_2P'] text-xs"
              >
                CONFIRM
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header with Reset Button */}
      <div className="bg-gray-900/50 border-b border-red-900/50 p-3 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
          <span className="text-red-400 font-['Press_Start_2P'] text-xs uppercase tracking-wider">
            {config.aiName} CHAT TERMINAL
          </span>
        </div>
        <button
          onClick={() => setShowResetConfirm(true)}
          className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 text-red-300 hover:bg-red-800/50 hover:text-white px-3 py-1.5 rounded text-xs font-['JetBrains_Mono'] transition-colors"
          title="Reset Chat"
        >
          <i className="fa-solid fa-trash-can"></i>
          RESET
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6" id="chatLog">
        {messages.map((msg, idx) => (
          <div key={idx} className={flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}}>
            <div className={max-w-[85%] rounded p-4 font-['JetBrains_Mono'] text-sm md:text-base shadow-lg ${msg.role === 'user' ? 'bg-red-900/20 border border-red-600/50 text-gray-200' : 'bg-gray-900/80 border border-gray-700 text-gray-300'}}>
              <div className={text-xs font-bold mb-2 font-['Press_Start_2P'] uppercase flex items-center gap-2 ${msg.role === 'user' ? 'justify-end text-blue-400' : 'text-red-500'}}>
                {msg.role === 'user' ? <>YOU <i className="fa-solid fa-user"></i></> : <><i className="fa-solid fa-robot"></i> {config.aiName}</>}
              </div>
              <div className="message-content">{renderMessageContent(msg.text)}</div>
            </div>
          </div>
        ))}
        {isLoading && <div className="flex justify-start"><div className="bg-gray-900/80 border border-gray-700 rounded p-4 text-red-500 font-['Press_Start_2P'] text-xs animate-pulse">PROCESSING...</div></div>}
        <div ref={chatEndRef}></div>
      </div>

      {(selectedImages.length > 0 || isProcessingImages) && (
        <div className="bg-gray-900 border-t border-red-900/50 p-2 flex gap-2 overflow-x-auto items-center">
           {isProcessingImages && <i className="fa-solid fa-circle-notch fa-spin text-red-500 mx-2"></i>}
          {selectedImages.map((img, idx) => (
            <div key={idx} className="relative group w-14 h-14"><img src={img.preview} className="w-full h-full object-cover rounded border border-gray-600" /><button onClick={() => removeImage(idx)} className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs">&times;</button></div>
          ))}
        </div>
      )}

      <div className="bg-black p-4 border-t-2 border-red-900">
        <div className="flex items-end gap-2 relative">
          <button onClick={() => fileInputRef.current?.click()} className="h-12 w-12 flex items-center justify-center bg-gray-900 border border-gray-700 text-gray-400 hover:text-white rounded"><i className="fa-solid fa-image"></i></button>
          <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*" multiple className="hidden" />
          <textarea 
            ref={inputRef} 
            value={input} 
            onChange={(e) => setInput(e.target.value)} 
            onKeyDown={(e) => { 
              if (e.key === 'Enter' && !e.shiftKey) { 
                e.preventDefault(); 
                handleSendMessage(); 
              }
            }} 
            placeholder={Type "reset" to clear chat or command ${config.aiName}...} 
            className="flex-1 bg-gray-900 border border-gray-700 text-white p-3 rounded focus:border-red-500 font-['JetBrains_Mono'] resize-none min-h-[48px] max-h-[120px]" 
            rows={1} 
          />
          <button onClick={handleSendMessage} disabled={isLoading || (!input.trim() && selectedImages.length === 0)} className="h-12 w-12 bg-red-800 text-white rounded flex items-center justify-center hover:bg-red-700 disabled:opacity-50"><i className="fa-solid fa-paper-plane"></i></button>
        </div>
        <div className="mt-2 text-xs text-gray-500 font-['JetBrains_Mono'] flex justify-between">
          <span>Enter: Send • Shift+Enter: New Line</span>
          <span>Type "reset" to clear chat</span>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
