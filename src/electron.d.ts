export {}

declare global {
  interface Window {
    xiaoyu?: {
      generateText: (payload: { brief: string; targetDuration: number; style: string }) => Promise<{
        text: string
        hanCount: number
        minChars: number
        maxChars: number
        estimatedDuration: number
        withinRange: boolean
        attempts: number
        model: string
        elapsedMs: number
      }>
      generateCharacter: (payload: { script: string; gender: string; style: string }) => Promise<{ description: string }>
      generateImage: (payload: { description: string; modifyNote?: string }) => Promise<{ previewUrl: string; filePath: string; sourceUrl: string }>
      generateAudio: (payload: { text: string; voice: string; speed: number; style: string }) => Promise<{ previewUrl: string; filePath: string; duration: number; voice: string }>
      previewVoice: (payload: { voice: string }) => Promise<{ previewUrl: string; voice: string }>
      generateVideo: (payload: { imageSourceUrl: string; audioFilePath: string; script: string; audioDuration: number; subtitles: boolean; resolution: '1080p' | '720p' }) => Promise<{ previewUrl: string; filePath: string; duration: number }>
      showInFolder: (filePath: string) => Promise<{ ok: boolean }>
      onTaskProgress: (callback: (data: { task: string; stage: string; progress: number }) => void) => () => void
      getApiStatus: () => Promise<{ deepseek: boolean; mimo: boolean; ark: boolean; dashscope: boolean }>
      saveApiKeys: (payload: { deepseek?: string; mimo?: string; ark?: string; dashscope?: string }) => Promise<{ ok: boolean }>
    }
  }
}
