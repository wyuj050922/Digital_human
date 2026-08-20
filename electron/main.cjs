const { app, BrowserWindow, ipcMain, safeStorage, shell, protocol, dialog } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const { Readable } = require('node:stream')
const dotenv = require('dotenv')

protocol.registerSchemesAsPrivileged([
  { scheme: 'xiaoyu-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

const mediaFiles = new Map()
const voiceSampleCache = new Map()
const ARK_VIDEO_BASE = 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks'
const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/api/v1'

const projectDir = path.resolve(__dirname, '..')
if (!app.isPackaged) dotenv.config({ path: path.join(projectDir, '.env.local'), quiet: true })

const countHan = (text) => (String(text).match(/[\u3400-\u9fff]/g) || []).length
const cleanText = (text) => String(text || '').replace(/^```[\s\S]*?\n|```$/g, '').trim()

function secretsPath() {
  return path.join(app.getPath('userData'), 'secrets.json')
}

function readSecretStore() {
  try {
    return JSON.parse(fs.readFileSync(secretsPath(), 'utf8'))
  } catch {
    return {}
  }
}

function writeSecretStore(store) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows安全存储当前不可用，未保存密钥')
  fs.mkdirSync(path.dirname(secretsPath()), { recursive: true })
  fs.writeFileSync(secretsPath(), JSON.stringify(store), { encoding: 'utf8', mode: 0o600 })
}

function encryptSecret(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows安全存储当前不可用')
  return safeStorage.encryptString(value).toString('base64')
}

function decryptSecret(value) {
  if (!value || !safeStorage.isEncryptionAvailable()) return ''
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'))
  } catch {
    return ''
  }
}

function getApiKey(name, envName) {
  const store = readSecretStore()
  return decryptSecret(store[name]) || process.env[envName] || ''
}

function migrateDevelopmentKeys() {
  if (!safeStorage.isEncryptionAvailable()) return
  const currentPath = secretsPath()
  const legacyPath = path.join(app.getPath('appData'), 'xiaoyu-digital-human', 'secrets.json')
  if (!fs.existsSync(currentPath) && legacyPath !== currentPath && fs.existsSync(legacyPath)) {
    fs.mkdirSync(path.dirname(currentPath), { recursive: true })
    fs.copyFileSync(legacyPath, currentPath)
  }
  const store = readSecretStore()
  const mappings = {
    deepseek: 'DEEPSEEK_API_KEY',
    mimo: 'MIMO_API_KEY',
    ark: 'ARK_API_KEY',
    dashscope: 'DASHSCOPE_API_KEY',
  }
  let changed = false
  for (const [name, envName] of Object.entries(mappings)) {
    if (!store[name] && process.env[envName]) {
      store[name] = encryptSecret(process.env[envName])
      changed = true
    }
  }
  if (changed) writeSecretStore(store)
}

function outputDir() {
  const dir = path.join(app.getPath('documents'), '小宇数字人', 'outputs')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function uniqueFile(prefix, extension) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  return path.join(outputDir(), `${prefix}_${stamp}_${Math.random().toString(36).slice(2, 7)}.${extension}`)
}

function previewUrlFor(filePath) {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  mediaFiles.set(token, filePath)
  return `xiaoyu-media://file/${token}`
}

function mediaType(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.mp4') return 'video/mp4'
  if (extension === '.wav') return 'audio/wav'
  if (extension === '.mp3') return 'audio/mpeg'
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  return 'application/octet-stream'
}

async function selectCustomImage() {
  const result = await dialog.showOpenDialog({
    title: '选择人物照片',
    properties: ['openFile'],
    filters: [{ name: '人物照片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  })
  if (result.canceled || !result.filePaths[0]) return null

  const sourcePath = result.filePaths[0]
  const extension = path.extname(sourcePath).toLowerCase()
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) throw new Error('请选择 JPG、PNG 或 WebP 格式的照片')
  const stats = await fs.promises.stat(sourcePath)
  if (!stats.isFile() || stats.size <= 0) throw new Error('所选照片无效或内容为空')
  if (stats.size > 20 * 1024 * 1024) throw new Error('照片不能超过20MB，请压缩后重试')

  const targetPath = uniqueFile('自定义人物照片', extension.slice(1) === 'jpeg' ? 'jpg' : extension.slice(1))
  await fs.promises.copyFile(sourcePath, targetPath)
  return {
    previewUrl: previewUrlFor(targetPath),
    filePath: targetPath,
    fileName: path.basename(sourcePath),
    size: stats.size,
  }
}

function streamMediaResponse(request, filePath) {
  const size = fs.statSync(filePath).size
  const range = request.headers.get('range')
  const headers = { 'Accept-Ranges': 'bytes', 'Content-Type': mediaType(filePath) }
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim())
    if (!match) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
    const start = match[1] ? Number(match[1]) : 0
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
    }
    const stream = Readable.toWeb(fs.createReadStream(filePath, { start, end }))
    return new Response(stream, { status: 206, headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` } })
  }
  return new Response(Readable.toWeb(fs.createReadStream(filePath)), { status: 200, headers: { ...headers, 'Content-Length': String(size) } })
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function sendProgress(event, stage, progress) {
  if (event?.sender && !event.sender.isDestroyed()) event.sender.send('task:progress', { task: 'video', stage, progress })
}

async function responseJson(response, serviceName) {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = body?.error?.message || body?.message || body?.msg || `${serviceName}请求失败（HTTP ${response.status}）`
    throw new Error(message)
  }
  return body
}

async function downloadToFile(url, prefix, fallbackExtension) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`生成文件下载失败（HTTP ${response.status}）`)
  const contentType = response.headers.get('content-type') || ''
  const extension = contentType.includes('png') ? 'png' : contentType.includes('jpeg') ? 'jpg' : fallbackExtension
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length) throw new Error('生成文件为空')
  const filePath = uniqueFile(prefix, extension)
  await fs.promises.writeFile(filePath, buffer)
  return { filePath, buffer, contentType }
}

function wavDuration(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') return 0
  const byteRate = buffer.readUInt32LE(28)
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === 'data' && byteRate > 0) return size / byteRate
    offset += 8 + size + (size % 2)
  }
  return 0
}

async function requestDeepSeek(messages) {
  const apiKey = getApiKey('deepseek', 'DEEPSEEK_API_KEY')
  if (!apiKey) throw new Error('请先在设置中心配置 DeepSeek API Key')

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-v4-flash', messages, stream: false }),
      signal: AbortSignal.timeout(60_000),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body?.error?.message || `DeepSeek请求失败（HTTP ${response.status}）`)
    const content = cleanText(body?.choices?.[0]?.message?.content)
    if (content) return { content, model: body.model || 'deepseek-v4-flash' }
    if (attempt < 2) await sleep(800)
  }
  throw new Error('DeepSeek连续两次返回空文案，请稍后重试')
}

async function generateCharacter(payload) {
  const script = String(payload?.script || '').trim()
  const gender = String(payload?.gender || '不限定').trim()
  const style = String(payload?.style || '校园介绍').trim()
  if (!script) throw new Error('请先确认口播文案')
  const result = await requestDeepSeek([
    { role: 'system', content: '你是数字人口播人物视觉设计师。只返回一段可直接用于文生图的中文人物描述，不要标题、解释或Markdown。描述需包含年龄感、性别、发型、服装、神态、姿态、背景、灯光、构图，并强调正面、上半身、嘴唇闭合、无遮挡、9:16竖屏、无文字、无水印。' },
    { role: 'user', content: `口播文案：${script}\n人物性别：${gender}\n内容风格：${style}\n请设计与内容匹配的人物形象。` },
  ])
  return { description: result.content }
}

async function generateImage(payload) {
  const apiKey = getApiKey('ark', 'ARK_API_KEY')
  if (!apiKey) throw new Error('请先在设置中心配置火山方舟 API Key')
  const description = String(payload?.description || '').trim()
  const modifyNote = String(payload?.modifyNote || '').trim()
  if (!description) throw new Error('人物描述不能为空')
  const prompt = `${description}${modifyNote ? `\n重点修改要求：${modifyNote}` : ''}\n固定要求：人物正面面对镜头，嘴唇自然闭合，五官清晰，手部不遮挡脸部，真实自然，9:16竖屏，无任何文字、标志和水印。`
  const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'doubao-seedream-5-0-260128',
      prompt,
      sequential_image_generation: 'disabled',
      response_format: 'url',
      size: '2K',
      stream: false,
      watermark: false,
    }),
    signal: AbortSignal.timeout(180_000),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error?.message || `人物图片生成失败（HTTP ${response.status}）`)
  const sourceUrl = body?.data?.[0]?.url
  if (!sourceUrl) throw new Error('火山方舟未返回人物图片地址')
  const saved = await downloadToFile(sourceUrl, '人物图片', 'jpg')
  const mime = saved.contentType.includes('png') ? 'image/png' : 'image/jpeg'
  return { previewUrl: `data:${mime};base64,${saved.buffer.toString('base64')}`, filePath: saved.filePath, sourceUrl }
}

async function requestMimoSpeech({ text, voice, speed = 1, style = '自然亲切' }) {
  const apiKey = getApiKey('mimo', 'MIMO_API_KEY')
  if (!apiKey) throw new Error('请先在设置中心配置 MiMo API Key')
  text = String(text || '').trim()
  voice = String(voice || '冰糖')
  speed = Number(speed || 1)
  style = String(style || '自然亲切')
  const allowedVoices = ['冰糖', '茉莉', '苏打', '白桦']
  if (!text) throw new Error('口播文案不能为空')
  if (!allowedVoices.includes(voice)) throw new Error('所选音色不可用')
  const pace = speed > 1.05 ? '语速稍快' : speed < 0.95 ? '语速稍慢' : '语速中等'
  const response = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mimo-v2.5-tts',
      messages: [
        { role: 'user', content: `使用自然、清晰的普通话进行${style}，${pace}，停顿自然，吐字清楚。` },
        { role: 'assistant', content: text },
      ],
      audio: { format: 'wav', voice },
      stream: false,
    }),
    signal: AbortSignal.timeout(180_000),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error?.message || `MiMo语音生成失败（HTTP ${response.status}）`)
  const audioBase64 = body?.choices?.[0]?.message?.audio?.data
  if (!audioBase64) throw new Error('MiMo未返回音频数据')
  const buffer = Buffer.from(audioBase64, 'base64')
  if (!buffer.length) throw new Error('MiMo返回了空音频')
  return { audioBase64, buffer }
}

async function generateAudio(payload) {
  const text = String(payload?.text || '').trim()
  const voice = String(payload?.voice || '冰糖')
  const result = await requestMimoSpeech({ text, voice, speed: payload?.speed, style: payload?.style })
  const filePath = uniqueFile('口播语音', 'wav')
  await fs.promises.writeFile(filePath, result.buffer)
  return {
    previewUrl: `data:audio/wav;base64,${result.audioBase64}`,
    filePath,
    duration: Number(wavDuration(result.buffer).toFixed(2)),
    voice,
  }
}

async function previewVoice(payload) {
  const voice = String(payload?.voice || '')
  if (voiceSampleCache.has(voice)) return voiceSampleCache.get(voice)
  const result = await requestMimoSpeech({ text: '该产品是由小宇制作的。', voice, speed: 1, style: '自然亲切的产品介绍' })
  const sample = { previewUrl: `data:audio/wav;base64,${result.audioBase64}`, voice }
  voiceSampleCache.set(voice, sample)
  return sample
}

async function createIdleVideo(imageUrl, event, resolution = '1080p') {
  const apiKey = getApiKey('ark', 'ARK_API_KEY')
  if (!apiKey) throw new Error('请先在设置中心配置火山方舟 API Key')
  sendProgress(event, '准备人物素材', 10)
  const response = await fetch(ARK_VIDEO_BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'doubao-seedance-1-0-pro-fast-251015',
      content: [
        {
          type: 'text',
          text: `人物正面自然站立并注视镜头，保持身份、服装和背景完全一致，仅有自然眨眼、轻微呼吸与小幅头部动作，嘴唇保持自然闭合，镜头固定，动作稳定，适合数字人口播  --resolution ${resolution === '720p' ? '720p' : '1080p'} --duration 5 --camerafixed true --watermark false`,
        },
        { type: 'image_url', image_url: { url: imageUrl } },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  })
  const body = await responseJson(response, '待机视频创建')
  const taskId = body?.id
  if (!taskId) throw new Error('火山方舟未返回视频任务ID')

  const startedAt = Date.now()
  let delay = 5_000
  while (Date.now() - startedAt < 20 * 60_000) {
    await sleep(delay)
    const poll = await fetch(`${ARK_VIDEO_BASE}/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60_000),
    })
    const state = await responseJson(poll, '待机视频查询')
    if (state?.status === 'succeeded' && state?.content?.video_url) {
      sendProgress(event, '自然动作生成完成', 38)
      return { taskId, url: state.content.video_url }
    }
    if (state?.status === 'failed' || state?.status === 'cancelled') {
      throw new Error(state?.error?.message || `待机视频任务${state.status}`)
    }
    const elapsed = Date.now() - startedAt
    sendProgress(event, state?.status === 'queued' ? '等待生成资源' : '正在生成自然动作', Math.min(36, 14 + Math.round(elapsed / 18_000)))
    delay = Math.min(15_000, Math.round(delay * 1.4))
  }
  throw new Error('待机视频生成超时，请稍后重试')
}

async function uploadDashScopeFile(filePath, model) {
  const apiKey = getApiKey('dashscope', 'DASHSCOPE_API_KEY')
  if (!apiKey) throw new Error('请先在设置中心配置阿里云百炼 API Key')
  const policyResponse = await fetch(`${DASHSCOPE_BASE}/uploads?action=getPolicy&model=${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60_000),
  })
  const policyBody = await responseJson(policyResponse, '阿里云临时上传授权')
  const data = policyBody?.data
  if (!data?.upload_host || !data?.upload_dir || !data?.policy || !data?.signature || !data?.oss_access_key_id) {
    throw new Error('阿里云未返回完整的临时上传授权')
  }
  const buffer = await fs.promises.readFile(filePath)
  if (!buffer.length) throw new Error('待上传音频为空')
  const objectKey = `${data.upload_dir}/${path.basename(filePath)}`
  const form = new FormData()
  form.append('OSSAccessKeyId', data.oss_access_key_id)
  form.append('Signature', data.signature)
  form.append('policy', data.policy)
  form.append('x-oss-object-acl', data.x_oss_object_acl || 'private')
  form.append('x-oss-forbid-overwrite', data.x_oss_forbid_overwrite || 'true')
  form.append('key', objectKey)
  form.append('success_action_status', '200')
  const extension = path.extname(filePath).toLowerCase()
  const mimeType = extension === '.mp4' ? 'video/mp4' : extension === '.mp3' ? 'audio/mpeg' : 'audio/wav'
  form.append('file', new Blob([buffer], { type: mimeType }), path.basename(filePath))
  const uploadResponse = await fetch(data.upload_host, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(120_000),
  })
  if (!uploadResponse.ok) throw new Error(`音频上传阿里云临时存储失败（HTTP ${uploadResponse.status}）`)
  return `oss://${objectKey}`
}

async function createLipSyncVideo(videoUrl, audioUrl, audioDuration, event) {
  const apiKey = getApiKey('dashscope', 'DASHSCOPE_API_KEY')
  if (!apiKey) throw new Error('请先在设置中心配置阿里云百炼 API Key')
  sendProgress(event, '提交口型同步任务', 48)
  const response = await fetch(`${DASHSCOPE_BASE}/services/aigc/image2video/video-synthesis/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
      'X-DashScope-OssResourceResolve': 'enable',
    },
    body: JSON.stringify({
      model: 'videoretalk',
      input: { video_url: videoUrl, audio_url: audioUrl, ref_image_url: '' },
      parameters: { video_extension: Number(audioDuration) > 5 },
    }),
    signal: AbortSignal.timeout(120_000),
  })
  const body = await responseJson(response, '口型同步创建')
  const taskId = body?.output?.task_id
  if (!taskId) throw new Error('VideoRetalk未返回任务ID')

  const startedAt = Date.now()
  let delay = 5_000
  while (Date.now() - startedAt < 20 * 60_000) {
    await sleep(delay)
    const poll = await fetch(`${DASHSCOPE_BASE}/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(60_000),
    })
    const state = await responseJson(poll, '口型同步查询')
    const status = state?.output?.task_status
    if (status === 'SUCCEEDED' && state?.output?.video_url) {
      sendProgress(event, '口型同步完成', 78)
      return { taskId, url: state.output.video_url, duration: Number(state?.usage?.video_duration || audioDuration) }
    }
    if (status === 'FAILED' || status === 'UNKNOWN') {
      throw new Error(state?.output?.message || state?.message || `口型同步任务${status}`)
    }
    const elapsed = Date.now() - startedAt
    sendProgress(event, '正在同步人物口型', Math.min(75, 50 + Math.round(elapsed / 25_000)))
    delay = Math.min(15_000, Math.round(delay * 1.4))
  }
  throw new Error('口型同步超时，请稍后重试')
}

function assTimestamp(seconds) {
  const value = Math.max(0, Number(seconds) || 0)
  const hours = Math.floor(value / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const secs = (value % 60).toFixed(2).padStart(5, '0')
  return `${hours}:${String(minutes).padStart(2, '0')}:${secs}`
}

function splitSubtitleText(text) {
  const chunks = String(text || '').split(/(?<=[。！？!?；;])/).map(item => item.trim()).filter(Boolean)
  const result = []
  for (const chunk of chunks) {
    if (countHan(chunk) <= 18) result.push(chunk)
    else {
      const parts = chunk.split(/(?<=[，,、：:])/).map(item => item.trim()).filter(Boolean)
      result.push(...(parts.length > 1 ? parts : (chunk.match(/.{1,18}/g) || [chunk])))
    }
  }
  return result.length ? result : [String(text || '')]
}

async function createAssFile(script, duration, resolution = '1080p') {
  const width = resolution === '720p' ? 720 : 1080
  const height = resolution === '720p' ? 1280 : 1920
  const fontSize = resolution === '720p' ? 43 : 64
  const marginV = resolution === '720p' ? 100 : 150
  const parts = splitSubtitleText(script)
  const weights = parts.map(part => Math.max(1, countHan(part)))
  const total = weights.reduce((sum, value) => sum + value, 0)
  let cursor = 0
  const dialogues = parts.map((part, index) => {
    const start = cursor
    cursor = index === parts.length - 1 ? duration : cursor + duration * weights[index] / total
    const safeText = part.replace(/[{}]/g, '').replace(/\r?\n/g, '\\N')
    return `Dialogue: 0,${assTimestamp(start)},${assTimestamp(cursor)},Default,,0,0,0,,${safeText}`
  }).join('\n')
  const content = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Microsoft YaHei,${fontSize},&H00FFFFFF,&H000000FF,&H00101010,&H78000000,-1,0,0,0,100,100,0,0,1,4,1,2,60,60,${marginV},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${dialogues}\n`
  const filePath = uniqueFile('字幕', 'ass')
  await fs.promises.writeFile(filePath, content, 'utf8')
  return filePath
}

function ffmpegPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'bin', 'ffmpeg.exe') : path.join(projectDir, 'resources', 'bin', 'ffmpeg.exe')
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const binary = ffmpegPath()
    if (!fs.existsSync(binary)) return reject(new Error('未找到内置FFmpeg组件'))
    const child = spawn(binary, args, { windowsHide: true, shell: false })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-6000) })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`字幕合成失败（FFmpeg ${code}）：${stderr.slice(-500)}`)))
  })
}

async function finalizeSyncedVideo(videoUrl, script, duration, subtitles, event, resolution = '1080p') {
  const dimensions = resolution === '720p' ? '720:1280' : '1080:1920'
  sendProgress(event, subtitles ? '正在添加字幕' : '正在导出视频', 84)
  const downloaded = await downloadToFile(videoUrl, '口型同步视频', 'mp4')
  let finalPath = downloaded.filePath
  if (subtitles) {
    const assPath = await createAssFile(script, duration, resolution)
    finalPath = uniqueFile('小宇数字人成片', 'mp4')
    const filterPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
    await runFfmpeg(['-y', '-i', downloaded.filePath, '-vf', `scale=${dimensions},ass=filename='${filterPath}'`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'copy', '-movflags', '+faststart', finalPath])
  } else {
    finalPath = uniqueFile('小宇数字人成片', 'mp4')
    await runFfmpeg(['-y', '-i', downloaded.filePath, '-vf', `scale=${dimensions}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'copy', '-movflags', '+faststart', finalPath])
  }
  sendProgress(event, '生成完成', 100)
  return finalPath
}

async function createStillVideo(imageFilePath, event, resolution = '1080p') {
  if (!imageFilePath || !fs.existsSync(imageFilePath)) throw new Error('自己的照片不存在，请重新选择')
  const extension = path.extname(imageFilePath).toLowerCase()
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) throw new Error('自己的照片格式不受支持，请重新选择')
  const dimensions = resolution === '720p' ? '720:1280' : '1080:1920'
  const targetPath = uniqueFile('自定义人物待机视频', 'mp4')
  sendProgress(event, '正在准备自己的照片', 10)
  await runFfmpeg([
    '-y', '-loop', '1', '-i', imageFilePath, '-t', '5',
    '-vf', `scale=${dimensions}:force_original_aspect_ratio=increase,crop=${dimensions},format=yuv420p`,
    '-r', '25', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart', targetPath,
  ])
  sendProgress(event, '自己的照片已准备完成', 38)
  return { filePath: targetPath }
}

async function generateVideo(payload, event) {
  const imageMode = payload?.imageMode === 'upload' ? 'upload' : 'ai'
  const imageSourceUrl = String(payload?.imageSourceUrl || '')
  const imageFilePath = String(payload?.imageFilePath || '')
  const audioFilePath = String(payload?.audioFilePath || '')
  const script = String(payload?.script || '').trim()
  const audioDuration = Number(payload?.audioDuration || 0)
  const subtitles = payload?.subtitles !== false
  const resolution = payload?.resolution === '720p' ? '720p' : '1080p'
  if (imageMode === 'ai' && !/^https:\/\//i.test(imageSourceUrl)) throw new Error('人物图片地址已失效，请重新生成人物图片')
  if (imageMode === 'upload' && (!imageFilePath || !fs.existsSync(imageFilePath))) throw new Error('自己的照片不存在，请重新选择')
  if (!audioFilePath || !fs.existsSync(audioFilePath)) throw new Error('语音文件不存在，请重新生成语音')
  if (!script || audioDuration <= 0) throw new Error('视频参数不完整，请重新确认文案与语音')

  sendProgress(event, '准备生成资源', 6)
  const [audioUrl, idle] = await Promise.all([
    uploadDashScopeFile(audioFilePath, 'videoretalk'),
    imageMode === 'upload' ? createStillVideo(imageFilePath, event, resolution) : createIdleVideo(imageSourceUrl, event, resolution),
  ])
  let idleUrl = idle.url
  if (imageMode === 'upload') {
    sendProgress(event, '正在上传人物素材', 42)
    idleUrl = await uploadDashScopeFile(idle.filePath, 'videoretalk')
  }
  const synced = await createLipSyncVideo(idleUrl, audioUrl, audioDuration, event)
  const finalPath = await finalizeSyncedVideo(synced.url, script, synced.duration || audioDuration, subtitles, event, resolution)
  return { previewUrl: previewUrlFor(finalPath), filePath: finalPath, duration: synced.duration || audioDuration }
}

async function generateText(payload) {
  const brief = String(payload?.brief || '').trim()
  const style = String(payload?.style || '自然口播').trim().slice(0, 30)
  const targetDuration = Number(payload?.targetDuration)
  if (!brief) throw new Error('请输入主题或大致文案')
  if (!Number.isFinite(targetDuration) || targetDuration < 5 || targetDuration > 600) throw new Error('目标时长应在5至600秒之间')

  const minChars = Math.max(12, Math.round(targetDuration * 3.3))
  const maxChars = Math.max(minChars + 4, Math.round(targetDuration * 4))
  const system = '你是一名中文短视频口播文案编辑。请保持事实准确、语言自然、逻辑完整。不要输出标题、项目符号、Markdown、舞台说明、表情符号或字数解释，只返回可直接用于语音合成的最终口播正文。'
  const firstPrompt = `请根据以下要求创作中文口播文案：\n主题或原始内容：${brief}\n目标时长：约${targetDuration}秒\n目标汉字数：${minChars}至${maxChars}个（不含标点）\n表达风格：${style}\n不得虚构具体数据，只返回正文。`
  const startedAt = Date.now()
  let result = await requestDeepSeek([{ role: 'system', content: system }, { role: 'user', content: firstPrompt }])
  let attempts = 1
  let hanCount = countHan(result.content)

  if (hanCount < minChars || hanCount > maxChars) {
    const action = hanCount < minChars ? '自然扩写' : '精简'
    result = await requestDeepSeek([
      { role: 'system', content: system },
      { role: 'user', content: firstPrompt },
      { role: 'assistant', content: result.content },
      { role: 'user', content: `这份正文有${hanCount}个汉字，不符合${minChars}至${maxChars}个汉字的范围。请${action}到目标范围，保留主题和关键信息，只返回修改后的正文。` },
    ])
    attempts = 2
    hanCount = countHan(result.content)
  }

  return {
    text: result.content,
    hanCount,
    minChars,
    maxChars,
    estimatedDuration: Number((hanCount / 3.6).toFixed(1)),
    withinRange: hanCount >= minChars && hanCount <= maxChars,
    attempts,
    model: result.model,
    elapsedMs: Date.now() - startedAt,
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    title: '小宇数字人',
    icon: path.join(projectDir, 'resources', 'branding', 'xiaoyu-icon.png'),
    backgroundColor: '#f3f6fb',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL)
    if (!allowed && !url.startsWith('file:')) event.preventDefault()
  })
  win.once('ready-to-show', () => win.show())

  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL)
  else win.loadFile(path.join(projectDir, 'dist', 'index.html'))
}

app.whenReady().then(() => {
  migrateDevelopmentKeys()
  protocol.handle('xiaoyu-media', request => {
    const token = new URL(request.url).pathname.split('/').filter(Boolean).pop()
    const filePath = token ? mediaFiles.get(token) : ''
    if (!filePath || !fs.existsSync(filePath)) return new Response('Not found', { status: 404 })
    return streamMediaResponse(request, filePath)
  })

  if (!app.isPackaged && process.argv.includes('--seedance-fast-smoke-test')) {
    const sampleImage = 'https://ark-project.tos-cn-beijing.volces.com/doc_image/seepro_i2v.png'
    createIdleVideo(sampleImage, undefined, '1080p').then(async result => {
      const saved = await downloadToFile(result.url, 'Seedance1.0ProFast_测试视频', 'mp4')
      console.log(JSON.stringify({ ok: true, taskId: result.taskId, videoFile: saved.filePath }))
      app.quit()
    }).catch(error => {
      console.error(JSON.stringify({ ok: false, error: error?.message || 'Seedance Fast验收失败' }))
      app.exit(1)
    })
    return
  }

  if (!app.isPackaged && process.argv.includes('--final-stages-smoke-test')) {
    const script = '欢迎了解平顶山学院。这里校园环境优美，学习氛围浓厚，是青年学子学习知识、锻炼能力和探索未来的成长园地。'
    const idleFile = path.join(projectDir, '..', '平顶山学院数字人_Seedance1.0Pro_待机5秒.mp4')
    generateAudio({ text: script, voice: '冰糖', speed: 1, style: '校园介绍' }).then(async audio => {
      if (!fs.existsSync(idleFile)) throw new Error('末段验收所需的待机视频不存在')
      const [audioUrl, videoUrl] = await Promise.all([
        uploadDashScopeFile(audio.filePath, 'videoretalk'),
        uploadDashScopeFile(idleFile, 'videoretalk'),
      ])
      const synced = await createLipSyncVideo(videoUrl, audioUrl, audio.duration)
      const finalPath = await finalizeSyncedVideo(synced.url, script, synced.duration || audio.duration, true)
      console.log(JSON.stringify({ ok: true, audioFile: audio.filePath, audioDuration: audio.duration, videoFile: finalPath, videoDuration: synced.duration }))
      app.quit()
    }).catch(error => {
      console.error(JSON.stringify({ ok: false, error: error?.message || '末段验收失败' }))
      app.exit(1)
    })
    return
  }

  if (!app.isPackaged && process.argv.includes('--full-pipeline-smoke-test')) {
    const script = '欢迎了解平顶山学院。这里校园环境优美，学习氛围浓厚，是青年学子学习知识、锻炼能力和探索未来的成长园地。'
    generateAudio({ text: script, voice: '冰糖', speed: 1, style: '校园介绍' }).then(async audio => {
      const image = await generateImage({ description: '一位年轻的中国女性校园讲解员，黑色中长发，穿浅蓝衬衫与白色外套，上半身正面面对镜头，神态自然亲切，背景为阳光下的现代大学校园，真实摄影质感，柔和自然光，人物居中，嘴唇闭合，9:16竖屏构图，无文字无水印。' })
      const video = await generateVideo({
        imageSourceUrl: image.sourceUrl,
        audioFilePath: audio.filePath,
        script,
        audioDuration: audio.duration,
        subtitles: true,
      })
      console.log(JSON.stringify({ ok: true, imageFile: image.filePath, audioFile: audio.filePath, audioDuration: audio.duration, videoFile: video.filePath, videoDuration: video.duration }))
      app.quit()
    }).catch(error => {
      console.error(JSON.stringify({ ok: false, error: error?.message || '全流程验收失败' }))
      app.exit(1)
    })
    return
  }

  if (!app.isPackaged && process.argv.includes('--api-smoke-test')) {
    const script = '欢迎了解平顶山学院。这里校园环境优美，学习氛围浓厚，是青年学子学习知识、锻炼能力和探索未来的成长园地。'
    Promise.all([
      generateCharacter({ script, gender: '女性', style: '校园介绍' }),
      generateAudio({ text: script, voice: '冰糖', speed: 1, style: '校园介绍' }),
    ]).then(async ([character, audio]) => {
      const image = await generateImage({ description: character.description })
      console.log(JSON.stringify({
        ok: true,
        characterLength: character.description.length,
        imageFile: image.filePath,
        audioFile: audio.filePath,
        audioDuration: audio.duration,
        voice: audio.voice,
      }))
      app.quit()
    }).catch(error => {
      console.error(JSON.stringify({ ok: false, error: error?.message || '验收失败' }))
      app.exit(1)
    })
    return
  }

  ipcMain.handle('config:get-api-status', () => ({
    deepseek: Boolean(getApiKey('deepseek', 'DEEPSEEK_API_KEY')),
    mimo: Boolean(getApiKey('mimo', 'MIMO_API_KEY')),
    ark: Boolean(getApiKey('ark', 'ARK_API_KEY')),
    dashscope: Boolean(getApiKey('dashscope', 'DASHSCOPE_API_KEY')),
  }))
  ipcMain.handle('config:save-api-keys', (_event, payload) => {
    const store = readSecretStore()
    let changed = false
    for (const name of ['deepseek', 'mimo', 'ark', 'dashscope']) {
      const value = String(payload?.[name] || '').trim()
      if (value) {
        store[name] = encryptSecret(value)
        changed = true
      }
    }
    if (!changed) throw new Error('请至少输入一个API Key')
    writeSecretStore(store)
    return { ok: true }
  })
  ipcMain.handle('deepseek:generate-text', (_event, payload) => generateText(payload))
  ipcMain.handle('deepseek:generate-character', (_event, payload) => generateCharacter(payload))
  ipcMain.handle('ark:generate-image', (_event, payload) => generateImage(payload))
  ipcMain.handle('file:select-custom-image', () => selectCustomImage())
  ipcMain.handle('mimo:generate-audio', (_event, payload) => generateAudio(payload))
  ipcMain.handle('mimo:preview-voice', (_event, payload) => previewVoice(payload))
  ipcMain.handle('video:generate', (event, payload) => generateVideo(payload, event))
  ipcMain.handle('file:show-in-folder', (_event, filePath) => {
    const value = String(filePath || '')
    if (!value || !fs.existsSync(value)) throw new Error('文件不存在')
    shell.showItemInFolder(value)
    return { ok: true }
  })

  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
