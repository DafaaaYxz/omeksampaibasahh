
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";

export interface ImageAttachment {
  inlineData: {
    data: string;
    mimeType: string;
  };
}

export const sendMessageToGemini = async (
  message: string,
  images: ImageAttachment[],
  history: { role: string; parts: { text: string }[] }[],
  config: {
    apiKeys: string[];
    systemInstruction: string;
  }
): Promise<string> => {
  
  const tryGenerate = async (retryIdx: number): Promise<string> => {
    if (retryIdx >= config.apiKeys.length) {
      throw new Error("All API keys exhausted.");
    }

    try {
      const apiKey = config.apiKeys[retryIdx];
      const ai = new GoogleGenAI({ apiKey });

      const formattedContents = history.map(msg => ({
        role: msg.role,
        parts: msg.parts
      }));

      const currentParts: any[] = [];
      
      if (message) {
        currentParts.push({ text: message });
      }

      if (images && images.length > 0) {
        images.forEach(img => {
          currentParts.push(img);
        });
      }

      if (currentParts.length === 0) {
        throw new Error("Message cannot be empty");
      }

      formattedContents.push({
        role: 'user',
        parts: currentParts
      });

      const safetySettings = [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ];

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: formattedContents,
        config: {
          systemInstruction: config.systemInstruction,
          safetySettings: safetySettings,
        }
      });

      if (response.text) {
        return response.text;
      }
      
      throw new Error("Empty response");

    } catch (error: any) {
      if (error.toString().includes("429") || error.toString().includes("403")) {
         return tryGenerate(retryIdx + 1);
      }
      throw error;
    }
  };

  return tryGenerate(0);
};

export const generateVeoVideo = async (
  prompt: string,
  config: { apiKeys: string[] }
): Promise<string> => {
  const tryGenerateVideo = async (retryIdx: number): Promise<string> => {
    if (retryIdx >= config.apiKeys.length) {
      throw new Error("All API keys exhausted.");
    }

    try {
      const apiKey = config.apiKeys[retryIdx];
      const ai = new GoogleGenAI({ apiKey });

      let operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: prompt,
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: '16:9'
        }
      });

      // Poll for completion
      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        operation = await ai.operations.getVideosOperation({operation: operation});
      }

      const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (!videoUri) throw new Error("Failed to generate video URI");
      
      return ${videoUri}&key=${apiKey};

    } catch (error: any) {
      console.error(error);
      if (error.toString().includes("429") || error.toString().includes("403")) {
         return tryGenerateVideo(retryIdx + 1);
      }
      throw error;
    }
  };

  return tryGenerateVideo(0);
};
