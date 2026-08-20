import { useEffect, useMemo, useRef, useState } from 'react'

type StepState = 'pending' | 'ready' | 'working' | 'done'
type Gender = '女性' | '男性' | '不限定'
type ImageMode = 'ai' | 'upload'

const scripts = [
  '想报考平顶山学院吗？这里山水环绕，四季皆景，书香浓郁，师资力量强，就业前景广。来这儿，遇见更好的自己，开启精彩未来，你心动了吗？',
  '平顶山学院坐落于河南省平顶山市。这里校园环境优美，学习氛围浓厚，为青年学子提供学习知识、锻炼能力与探索未来的成长平台。',
  '欢迎了解平顶山学院。这里既有浓厚的校园文化，也有充满活力的学习生活。愿每一位青年都能在这里积累知识，发现热爱，奔赴未来。',
]

const descriptions: Record<Gender, string> = {
  女性: '一位年轻的中国女性校园讲解员，约22岁，黑色中长发，穿浅蓝衬衫和白色外套，上半身正面面对镜头，神态自然亲切。背景为阳光下的现代大学校园，真实摄影质感，柔和自然光，人物居中，9:16竖屏构图。',
  男性: '一位年轻的中国男性校园讲解员，约24岁，黑色短发，穿浅色衬衫和深蓝休闲西装，上半身正面面对镜头，神态沉稳亲切。背景为阳光下的现代大学校园，真实摄影质感，柔和自然光，人物居中，9:16竖屏构图。',
  不限定: '一位年轻、亲切且富有活力的大学校园讲解员，上半身正面面对镜头，穿着简洁得体，五官清晰，表情自然。背景为阳光下的现代大学校园，真实摄影质感，柔和自然光，人物居中，9:16竖屏构图。',
}

const voices = [
  { name: '冰糖', desc: '自然亲和，适合校园和生活介绍', tag: '推荐', gender: '女性' },
  { name: '茉莉', desc: '清晰知性，适合正式内容讲解', tag: '知性', gender: '女性' },
  { name: '苏打', desc: '年轻自然，适合活力内容口播', tag: '活力', gender: '男性' },
  { name: '白桦', desc: '沉稳可靠，适合专业内容讲解', tag: '沉稳', gender: '男性' },
]

function countHan(text: string) {
  return (text.match(/[\u3400-\u9fff]/g) || []).length
}

function App() {
  const [mode, setMode] = useState<'ai' | 'strict'>('ai')
  const [brief, setBrief] = useState('介绍平顶山学院，面向准备报考的高中生，语气自然亲切。')
  const [script, setScript] = useState(scripts[0])
  const [scriptError, setScriptError] = useState('')
  const [duration, setDuration] = useState(15)
  const [customDuration, setCustomDuration] = useState('')
  const [style, setStyle] = useState('校园介绍')
  const [scriptState, setScriptState] = useState<StepState>('ready')
  const [gender, setGender] = useState<Gender>('女性')
  const [imageMode, setImageMode] = useState<ImageMode>('ai')
  const [description, setDescription] = useState(descriptions.女性)
  const [descriptionLoading, setDescriptionLoading] = useState(false)
  const [imageError, setImageError] = useState('')
  const [imagePreview, setImagePreview] = useState('')
  const [imageZoomOpen, setImageZoomOpen] = useState(false)
  const [imageSourceUrl, setImageSourceUrl] = useState('')
  const [imageFilePath, setImageFilePath] = useState('')
  const [customImageName, setCustomImageName] = useState('')
  const [customImageSize, setCustomImageSize] = useState(0)
  const [customImageDimensions, setCustomImageDimensions] = useState('')
  const [photoConsent, setPhotoConsent] = useState(false)
  const [modifyNote, setModifyNote] = useState('')
  const [imageState, setImageState] = useState<StepState>('pending')
  const [imageProgress, setImageProgress] = useState(0)
  const [selectedVoice, setSelectedVoice] = useState(0)
  const [previewingVoice, setPreviewingVoice] = useState<number | null>(null)
  const [voicePreviewError, setVoicePreviewError] = useState('')
  const [speed, setSpeed] = useState(1)
  const [volume, setVolume] = useState(85)
  const [audioState, setAudioState] = useState<StepState>('pending')
  const [audioProgress, setAudioProgress] = useState(0)
  const [audioError, setAudioError] = useState('')
  const [audioPreview, setAudioPreview] = useState('')
  const [audioFilePath, setAudioFilePath] = useState('')
  const [actualAudioDuration, setActualAudioDuration] = useState(0)
  const [audioConfirmed, setAudioConfirmed] = useState(false)
  const [videoState, setVideoState] = useState<StepState>('pending')
  const [videoProgress, setVideoProgress] = useState(0)
  const [videoStage, setVideoStage] = useState('等待语音确认')
  const [videoError, setVideoError] = useState('')
  const [finalVideoPreview, setFinalVideoPreview] = useState('')
  const [finalVideoPath, setFinalVideoPath] = useState('')
  const [subtitles, setSubtitles] = useState(true)
  const [resolution, setResolution] = useState<'1080p' | '720p'>('1080p')
  const [videoResultReady, setVideoResultReady] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [apiStatus, setApiStatus] = useState({ deepseek: false, mimo: false, ark: false, dashscope: false })
  const [apiInputs, setApiInputs] = useState({ deepseek: '', mimo: '', ark: '', dashscope: '' })
  const [settingsMessage, setSettingsMessage] = useState('')
  const audioRef = useRef<HTMLAudioElement>(null)
  const sampleAudioRef = useRef<HTMLAudioElement>(null)
  const videoProgressTarget = useRef(0)

  const hanCount = useMemo(() => countHan(script), [script])
  const estimated = useMemo(() => Math.max(1, hanCount / (3.6 * speed)), [hanCount, speed])
  const target = customDuration ? Number(customDuration) || duration : duration
  const withinTarget = Math.abs(estimated - target) <= 2
  const visibleVoices = useMemo(() => gender === '不限定' ? voices.map((voice, index) => ({ voice, index })) : voices.map((voice, index) => ({ voice, index })).filter(item => item.voice.gender === gender), [gender])

  useEffect(() => {
    void window.xiaoyu?.getApiStatus().then(setApiStatus)
    return window.xiaoyu?.onTaskProgress(data => {
      if (data.task === 'video') {
        setVideoStage(data.stage)
        videoProgressTarget.current = Math.max(videoProgressTarget.current, data.progress)
      }
    })
  }, [])

  useEffect(() => {
    if (videoState !== 'working') return
    const timer = window.setInterval(() => {
      setVideoProgress(current => current < videoProgressTarget.current ? Math.min(videoProgressTarget.current, current + 1) : current)
    }, 240)
    return () => window.clearInterval(timer)
  }, [videoState])

  useEffect(() => {
    if (videoResultReady && videoProgress >= 100) {
      setVideoResultReady(false)
      setVideoState('done')
    }
  }, [videoProgress, videoResultReady])

  const regenerateScript = async () => {
    resetAfterScriptEdit()
    setScriptState('working')
    setScriptError('')
    try {
      if (!window.xiaoyu) throw new Error('请在“小宇数字人”桌面软件中使用AI生成功能')
      const result = await window.xiaoyu.generateText({ brief, targetDuration: target, style })
      setScript(result.text)
      setScriptState('ready')
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '文案生成失败，请稍后重试'
      setScriptError(message)
      setScriptState('ready')
    }
  }

  const saveApiKeys = async () => {
    setSettingsMessage('')
    try {
      if (!window.xiaoyu) throw new Error('桌面安全服务未连接')
      await window.xiaoyu.saveApiKeys(apiInputs)
      setApiStatus(await window.xiaoyu.getApiStatus())
      setApiInputs({ deepseek: '', mimo: '', ark: '', dashscope: '' })
      setSettingsMessage('API密钥已通过Windows安全存储加密保存')
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '保存失败')
    }
  }

  const confirmScript = async () => {
    setScriptState('done')
    setImageState('ready')
    if (imageMode === 'upload') {
      setDescriptionLoading(false)
      setImageError('')
      return
    }
    setDescriptionLoading(true)
    setImageError('')
    try {
      if (!window.xiaoyu) throw new Error('桌面安全服务未连接')
      const result = await window.xiaoyu.generateCharacter({ script, gender, style })
      setDescription(result.description)
    } catch (error) {
      setDescription(descriptions[gender])
      setImageError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '人物描述生成失败')
    } finally {
      setDescriptionLoading(false)
    }
  }

  const changeGender = (next: Gender) => {
    setGender(next)
    setSelectedVoice(next === '男性' ? 2 : 0)
    if (imageMode === 'upload') {
      setAudioConfirmed(false)
      setAudioState(imageState === 'done' ? 'ready' : 'pending')
      resetAfterAudioSettings()
      return
    }
    resetAfterImageEdit()
    setDescription(descriptions[next])
    setImageState('ready')
  }

  const changeImageMode = (next: ImageMode) => {
    if (next === imageMode) return
    resetAfterImageEdit()
    setImageMode(next)
    setImageState('ready')
    setImageProgress(0)
    setImageError('')
    if (next === 'ai') setDescription(descriptions[gender])
  }

  const generateImage = async () => {
    resetAfterImageEdit()
    setImageState('working')
    setImageProgress(15)
    setImageError('')
    const timers = [window.setTimeout(() => setImageProgress(48), 1800), window.setTimeout(() => setImageProgress(78), 5000)]
    try {
      if (!window.xiaoyu) throw new Error('桌面安全服务未连接')
      const result = await window.xiaoyu.generateImage({ description, modifyNote })
      setImagePreview(result.previewUrl)
      setImageSourceUrl(result.sourceUrl)
      setImageFilePath(result.filePath)
      setImageProgress(100)
      setImageState('done')
      setAudioState('ready')
    } catch (error) {
      setImageError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '人物图片生成失败')
      setImageProgress(0)
      setImageState('ready')
    } finally {
      timers.forEach(window.clearTimeout)
    }
  }

  const selectCustomPhoto = async () => {
    setImageError('')
    try {
      if (!window.xiaoyu) throw new Error('桌面安全服务未连接')
      const result = await window.xiaoyu.selectCustomImage()
      if (!result) return
      resetAfterImageEdit()
      setImageState('working')
      setImageProgress(55)
      setImagePreview(result.previewUrl)
      setImageFilePath(result.filePath)
      setCustomImageName(result.fileName)
      setCustomImageSize(result.size)
      setImageProgress(100)
      setImageState('done')
      setAudioState('ready')
    } catch (error) {
      setImageError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '照片读取失败')
      setImageProgress(0)
      setImageState('ready')
    }
  }

  const removeCustomPhoto = () => {
    resetAfterImageEdit()
    setImageState('ready')
    setImageProgress(0)
    setImageError('')
  }

  const regenerateDescription = async () => {
    resetAfterImageEdit()
    setImageState('ready')
    setDescriptionLoading(true)
    setImageError('')
    try {
      if (!window.xiaoyu) throw new Error('桌面安全服务未连接')
      const result = await window.xiaoyu.generateCharacter({ script, gender, style })
      setDescription(result.description)
    } catch (error) {
      setImageError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '人物描述生成失败')
    } finally {
      setDescriptionLoading(false)
    }
  }

  const generateAudio = async () => {
    resetAfterAudioSettings()
    setAudioState('working')
    setAudioConfirmed(false)
    setAudioProgress(12)
    setAudioError('')
    const timers = [window.setTimeout(() => setAudioProgress(45), 1500), window.setTimeout(() => setAudioProgress(76), 4000)]
    try {
      if (!window.xiaoyu) throw new Error('桌面安全服务未连接')
      const result = await window.xiaoyu.generateAudio({ text: script, voice: voices[selectedVoice].name, speed, style })
      setAudioPreview(result.previewUrl)
      setAudioFilePath(result.filePath)
      setActualAudioDuration(result.duration)
      setAudioProgress(100)
      setAudioState('done')
    } catch (error) {
      setAudioError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '语音生成失败')
      setAudioProgress(0)
      setAudioState('ready')
    } finally {
      timers.forEach(window.clearTimeout)
    }
  }

  const confirmAudio = () => {
    setAudioConfirmed(true)
    setVideoState('ready')
  }

  const previewVoice = async (index: number) => {
    resetAfterAudioSettings()
    setAudioConfirmed(false)
    if (audioState === 'done') setAudioState('ready')
    setSelectedVoice(index)
    setPreviewingVoice(index)
    setVoicePreviewError('')
    try {
      if (!window.xiaoyu) throw new Error('桌面安全服务未连接')
      const result = await window.xiaoyu.previewVoice({ voice: voices[index].name })
      if (sampleAudioRef.current) {
        sampleAudioRef.current.src = result.previewUrl
        sampleAudioRef.current.currentTime = 0
        sampleAudioRef.current.volume = volume / 100
        await sampleAudioRef.current.play()
      }
    } catch (error) {
      setVoicePreviewError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '音色试听失败')
    } finally {
      setPreviewingVoice(null)
    }
  }

  const changeAudioSetting = () => {
    resetAfterAudioSettings()
    setAudioConfirmed(false)
    if (audioState === 'done') setAudioState('ready')
  }

  const generateVideo = async () => {
    setVideoState('working')
    setVideoProgress(0)
    videoProgressTarget.current = 3
    setVideoStage('正在检查素材')
    setVideoError('')
    try {
      if (!window.xiaoyu) throw new Error('桌面安全服务未连接')
      const result = await window.xiaoyu.generateVideo({ imageMode, imageSourceUrl, imageFilePath, audioFilePath, script, audioDuration: actualAudioDuration, subtitles, resolution })
      setFinalVideoPreview(result.previewUrl)
      setFinalVideoPath(result.filePath)
      videoProgressTarget.current = 100
      setVideoStage('生成完成')
      setVideoResultReady(true)
    } catch (error) {
      setVideoError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '视频生成失败')
      setVideoResultReady(false)
      setVideoState('ready')
    }
  }

  const resetAfterScriptEdit = () => {
    if (scriptState === 'done') {
      setScriptState('ready')
    }
    setImageState('pending')
    setImageProgress(0)
    resetAfterImageEdit()
  }

  const resetAfterImageEdit = () => {
    setImageSourceUrl('')
    setImageFilePath('')
    setImagePreview('')
    setCustomImageName('')
    setCustomImageSize(0)
    setCustomImageDimensions('')
    setImageZoomOpen(false)
    setAudioState('pending')
    setAudioProgress(0)
    setAudioConfirmed(false)
    resetAfterAudioSettings()
  }

  const resetAfterAudioSettings = () => {
    setVideoState('pending')
    setVideoProgress(0)
    videoProgressTarget.current = 0
    setVideoResultReady(false)
    setVideoStage('等待语音确认')
    setVideoError('')
    setFinalVideoPreview('')
    setFinalVideoPath('')
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><img src="/assets/xiaoyu-icon.png" alt="小宇数字人" /></div><div><b>小宇数字人</b><span>AI 数字人口播工作台</span></div></div>
        <nav>
          <a className="active">▣ <span>创建任务</span></a>
        </nav>
        <div className="side-bottom"><button className="side-link" onClick={() => setSettingsOpen(true)}>⚙ <span>设置中心</span></button></div>
      </aside>

      <main>
        <header><div><h1>创建数字人口播</h1><p>从文案到成片，按步骤完成内容创作</p></div><div className="header-actions"><button className="secondary">保存草稿</button><div className="avatar">吴</div></div></header>

        <div className="stepper">
          {['文案与时长', '人物形象', '配音', '生成成片'].map((label, index) => {
            const done = [scriptState === 'done', imageState === 'done', audioConfirmed, videoState === 'done'][index]
            const active = index === 0 ? scriptState !== 'done' : index === 1 ? scriptState === 'done' && imageState !== 'done' : index === 2 ? imageState === 'done' && !audioConfirmed : audioConfirmed
            return <div className={`step ${done ? 'done' : ''} ${active ? 'current' : ''}`} key={label}><span>{done ? '✓' : index + 1}</span><b>{label}</b></div>
          })}
        </div>

        <div className="workspace">
          <section className="flow">
            <article className={`panel ${scriptState === 'done' ? 'completed' : ''}`}>
              <PanelHead number="01" title="文案与时长" subtitle="确定内容与整条视频的目标时长" state={scriptState} />
              <div className="panel-body">
                <label className="field-label">文案方式</label>
                <div className="mode-grid">
                  <Choice selected={mode === 'ai'} onClick={() => { resetAfterScriptEdit(); setMode('ai') }} title="AI 设计文案" desc="根据主题和目标时长智能生成" />
                  <Choice selected={mode === 'strict'} onClick={() => { resetAfterScriptEdit(); setMode('strict'); setScript(brief) }} title="严格使用我的文案" desc="不进行任何改写，完整保留原文" />
                </div>
                <label className="field-label">{mode === 'ai' ? '主题或大致文案' : '我的完整文案'}</label>
                <textarea value={brief} onChange={e => { setBrief(e.target.value); if (mode === 'strict') setScript(e.target.value) }} />
                <div className="form-row">
                  <div className="grow"><label className="field-label">目标时长</label><div className="pills">{[15, 30, 60].map(d => <button className={duration === d && !customDuration ? 'selected' : ''} onClick={() => { resetAfterScriptEdit(); setDuration(d); setCustomDuration('') }} key={d}>{d}秒</button>)}<input aria-label="自定义时长" placeholder="自定义" value={customDuration} onChange={e => { resetAfterScriptEdit(); setCustomDuration(e.target.value.replace(/\D/g, '')) }} /></div></div>
                  <div><label className="field-label">内容风格</label><select value={style} onChange={e => setStyle(e.target.value)}><option>校园介绍</option><option>知识讲解</option><option>新闻播报</option><option>产品介绍</option></select></div>
                </div>
                <div className="section-line"><label className="field-label">最终口播文案</label>{mode === 'ai' && <button className="text-button" onClick={regenerateScript} disabled={scriptState === 'working'}>✦ {scriptState === 'working' ? '正在生成…' : 'AI 重新生成'}</button>}</div>
                <textarea className="script-box" value={script} onChange={e => { setScript(e.target.value); resetAfterScriptEdit() }} />
                {scriptError && <div className="inline-error">⚠ {scriptError}</div>}
                <div className="metrics"><span>{hanCount}个汉字</span><span>预计{estimated.toFixed(1)}秒</span><span className={withinTarget ? 'success' : 'warning'}>{withinTarget ? '✓ 符合目标时长' : `预计偏差${Math.abs(estimated - target).toFixed(1)}秒`}</span></div>
                <div className="actions"><button className="secondary" onClick={() => { resetAfterScriptEdit(); setScript(brief) }}>恢复原文</button><button className="primary" onClick={confirmScript}>确认文案</button></div>
              </div>
            </article>

            <article className={`panel ${scriptState !== 'done' ? 'locked' : ''} ${imageState === 'done' ? 'completed' : ''}`}>
              <PanelHead number="02" title="人物形象" subtitle="可以AI生成人物，也可以上传自己的照片" state={imageState} />
              <div className="panel-body">
                <label className="field-label">人物图片来源</label>
                <div className="mode-grid image-source-grid">
                  <Choice selected={imageMode === 'ai'} onClick={() => changeImageMode('ai')} title="AI 生成人物" desc="根据口播内容设计并生成人物图片" />
                  <Choice selected={imageMode === 'upload'} onClick={() => changeImageMode('upload')} title="上传自己的照片" desc="使用本人或已获得授权的人物照片" />
                </div>
                <label className="field-label">人物性别</label><div className="pills">{(['女性', '男性', '不限定'] as Gender[]).map(item => <button className={gender === item ? 'selected' : ''} onClick={() => changeGender(item)} key={item}>{item}</button>)}</div>
                {imageMode === 'ai' ? <>
                  <div className="section-line"><label className="field-label">AI 人物描述</label><button className="text-button" onClick={regenerateDescription} disabled={descriptionLoading}>✦ {descriptionLoading ? '正在生成描述…' : 'AI重新生成描述'}</button></div>
                  <textarea className="description-box" value={description} onChange={e => { resetAfterImageEdit(); setImageState('ready'); setDescription(e.target.value) }} />
                  <label className="field-label">重点修改要求（可选）</label><input className="input" value={modifyNote} onChange={e => setModifyNote(e.target.value)} placeholder="例如：发型更短一些，背景换成教学楼前" />
                </> : <div className="photo-upload-box">
                  <div className="photo-guidance"><b>选择适合数字人口播的照片</b><span>建议使用正脸、五官无遮挡、光线均匀的上半身照片；系统会自动裁切为竖屏画面。</span><span>支持 JPG、PNG、WebP，文件大小不超过 20MB。</span></div>
                  <label className="photo-consent"><input type="checkbox" checked={photoConsent} onChange={event => setPhotoConsent(event.target.checked)} /><span>我确认这是本人照片，或已获得照片人物的使用授权，并同意发送至第三方模型处理。</span></label>
                  {imageState !== 'done' && <div className="actions photo-actions"><button className="primary" onClick={() => void selectCustomPhoto()} disabled={!photoConsent || imageState === 'working'}>{imageState === 'working' ? '正在读取照片…' : '选择本地照片'}</button></div>}
                </div>}
                {imageError && <div className="inline-error">⚠ {imageError}</div>}
                {imageState === 'working' && <Progress label={imageMode === 'ai' ? '正在生成人物图片' : '正在读取自己的照片'} value={imageProgress} />}
                {imageState === 'done' ? <div className="image-result"><button className="image-thumb" onClick={() => setImageZoomOpen(true)} title="点击放大查看"><img src={imagePreview} alt={imageMode === 'ai' ? '生成的人物形象' : '自己上传的人物照片'} onLoad={event => { if (imageMode === 'upload') setCustomImageDimensions(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`) }} /><span>⌕</span></button><div><b>{imageMode === 'ai' ? 'AI人物形象' : '自己的照片'}</b><span>{imageMode === 'ai' ? '已生成 · 竖屏 9:16 · 可点击放大' : `${customImageName} · ${customImageDimensions || '正在读取尺寸'} · ${(customImageSize / 1024 / 1024).toFixed(2)}MB`}</span><div className="image-actions"><button className="secondary" onClick={() => setImageZoomOpen(true)}>放大查看</button>{imageMode === 'ai' ? <button className="secondary" onClick={generateImage}>重新生成图片</button> : <><button className="secondary" onClick={() => void selectCustomPhoto()} disabled={!photoConsent}>更换照片</button><button className="secondary danger" onClick={removeCustomPhoto}>移除照片</button></>}</div></div></div> : imageMode === 'ai' && <div className="actions"><button className="primary" onClick={generateImage} disabled={imageState === 'working' || descriptionLoading}>{imageState === 'working' ? '正在生成…' : '生成人物图片'}</button></div>}
              </div>
            </article>

            <article className={`panel ${imageState !== 'done' ? 'locked' : ''} ${audioConfirmed ? 'completed' : ''}`}>
              <PanelHead number="03" title="配音" subtitle="试听推荐音色，确认参数后生成完整语音" state={audioState} />
              <div className="panel-body">
                <audio ref={sampleAudioRef} className="visually-hidden" />
                <div className="section-line"><label className="field-label">AI 推荐音色 · {gender === '不限定' ? '全部' : `${gender}音色`}</label><small className="sample-text">试听内容：该产品是由小宇制作的</small></div>
                <div className="voice-grid">{visibleVoices.map(({ voice, index }) => <button className={`voice-card ${selectedVoice === index ? 'selected' : ''}`} onClick={() => void previewVoice(index)} disabled={previewingVoice !== null} key={voice.name}><span className="play">{previewingVoice === index ? '…' : '▶'}</span><div><b>{voice.name}<i>{voice.tag}</i></b><small>{voice.desc}</small></div><span className="radio" /></button>)}</div>
                {voicePreviewError && <div className="inline-error voice-error">⚠ {voicePreviewError}</div>}
                <div className="sliders"><label>语速 <b>{speed.toFixed(1)}x</b><input type="range" min="0.8" max="1.2" step="0.1" value={speed} onChange={e => { changeAudioSetting(); setSpeed(Number(e.target.value)) }} /></label><label>音量 <b>{volume}%</b><input type="range" min="0" max="100" value={volume} onChange={e => { changeAudioSetting(); setVolume(Number(e.target.value)) }} /></label></div>
                {audioState === 'working' && <Progress label="正在生成完整语音" value={audioProgress} />}
                {audioError && <div className="inline-error">⚠ {audioError}</div>}
                {audioState === 'done' && <div className="audio-result"><audio ref={audioRef} controls src={audioPreview} /><div className="audio-meta"><span>实际时长 {actualAudioDuration.toFixed(1)}秒</span><span>目标时长 {target}秒</span></div></div>}
                <div className="actions"><button className="secondary" onClick={generateAudio} disabled={audioState === 'working'}>{audioState === 'done' ? '更换设置后重新生成' : '生成完整语音'}</button>{audioState === 'done' && <button className="primary" onClick={confirmAudio}>确认使用此语音</button>}</div>
              </div>
            </article>

            <article className={`panel ${!audioConfirmed ? 'locked' : ''} ${videoState === 'done' ? 'completed' : ''}`}>
              <PanelHead number="04" title="生成成片" subtitle="自动完成动作、口型、字幕与视频导出" state={videoState} />
              <div className="panel-body video-layout">
                <div className="video-preview">{videoState === 'done' ? <video key={finalVideoPreview} controls preload="metadata" poster={imagePreview} src={finalVideoPreview} /> : <div className="video-empty"><span>▷</span><b>最终视频将在此预览</b><small>竖屏 {resolution === '1080p' ? '1080 × 1920' : '720 × 1280'}</small></div>}</div>
                <div className="video-controls">
                  <div className="setting-row"><span>显示字幕</span><button className={`switch ${subtitles ? 'on' : ''}`} disabled={videoState === 'working'} onClick={() => { if (videoState === 'done') { setVideoState('ready'); setFinalVideoPreview(''); setFinalVideoPath('') } setSubtitles(!subtitles) }}><i /></button></div>
                  <div className="setting-row"><span>输出分辨率</span><select className="resolution-select" value={resolution} disabled={videoState === 'working'} onChange={event => { if (videoState === 'done') { setVideoState('ready'); setFinalVideoPreview(''); setFinalVideoPath('') } setResolution(event.target.value as '1080p' | '720p') }}><option value="1080p">高清 1080 × 1920</option><option value="720p">流畅 720 × 1280</option></select></div>
                  {videoState === 'working' && <Progress label={videoStage} value={videoProgress} />}
                  {videoError && <div className="inline-error">⚠ {videoError}</div>}
                  <div className="stage-list">{['准备人物素材', imageMode === 'upload' ? '准备照片视频' : '生成自然动作', '同步人物口型', '添加字幕', '导出视频'].map((stage, index) => <div className={videoProgress >= [12,34,62,84,96][index] ? 'active' : ''} key={stage}><span>{videoProgress >= [12,34,62,84,96][index] ? '✓' : index + 1}</span>{stage}</div>)}</div>
                  <button className="primary full" onClick={generateVideo} disabled={videoState === 'working'}>{videoState === 'done' ? '重新生成最终视频' : videoState === 'working' ? `${videoStage} ${videoProgress}%` : '生成最终视频'}</button>
                  {videoState === 'done' && <button className="secondary full" onClick={() => void window.xiaoyu?.showInFolder(finalVideoPath)}>在文件夹中查看成片</button>}
                </div>
              </div>
            </article>
          </section>

          <aside className="summary">
            <h3>本次任务</h3><p>创建于刚刚</p>
            <SummaryRow label="目标时长" value={`${target}秒`} state="blue" />
            <SummaryRow label="文案" value={scriptState === 'done' ? '已确认' : '待确认'} state={scriptState === 'done' ? 'green' : 'orange'} />
            <SummaryRow label="人物" value={imageState === 'done' ? imageMode === 'upload' ? '已上传照片' : '已生成' : imageState === 'working' ? `${imageProgress}%` : '未准备'} state={imageState === 'done' ? 'green' : 'gray'} />
            <SummaryRow label="语音" value={audioConfirmed ? '已确认' : audioState === 'done' ? '待确认' : '未生成'} state={audioConfirmed ? 'green' : 'gray'} />
            <SummaryRow label="成片" value={videoState === 'done' ? '已完成' : videoState === 'working' ? `${videoProgress}%` : '未生成'} state={videoState === 'done' ? 'green' : 'gray'} />
            <div className="summary-note">ⓘ 生成过程将实时显示状态与耗时。修改上一步内容后，需要重新确认后续结果。</div>
          </aside>
        </div>
      </main>
      {imageZoomOpen && <div className="image-lightbox" onMouseDown={() => setImageZoomOpen(false)}><button className="lightbox-close" onClick={() => setImageZoomOpen(false)}>×</button><img src={imagePreview} alt="人物图片大图预览" onMouseDown={event => event.stopPropagation()} /></div>}
      {settingsOpen && <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}>
        <section className="settings-modal" onMouseDown={event => event.stopPropagation()}>
          <div className="modal-head"><div><h2>设置中心</h2><p>密钥仅保存在本机，并使用Windows安全存储加密</p></div><button onClick={() => setSettingsOpen(false)}>×</button></div>
          {([
            ['deepseek', 'DeepSeek · 文案与人物描述'],
            ['ark', '火山方舟 · 人物图片与自然动作'],
            ['mimo', 'MiMo · 口播语音'],
            ['dashscope', '阿里云百炼 · 口型同步'],
          ] as const).map(([name, label]) => <div className="api-setting" key={name}>
            <div className="api-status"><span>{label}</span><b className={apiStatus[name] ? 'configured' : ''}>{apiStatus[name] ? '已配置' : '未配置'}</b></div>
            <input className="input" type="password" autoComplete="off" value={apiInputs[name]} onChange={event => setApiInputs(current => ({ ...current, [name]: event.target.value }))} placeholder={apiStatus[name] ? '输入新密钥可替换现有配置' : '请输入API Key'} />
          </div>)}
          {settingsMessage && <div className={settingsMessage.includes('已通过') ? 'settings-success' : 'inline-error'}>{settingsMessage}</div>}
          <div className="actions"><button className="secondary" onClick={() => setSettingsOpen(false)}>取消</button><button className="primary" onClick={saveApiKeys} disabled={!Object.values(apiInputs).some(value => value.trim())}>加密保存</button></div>
        </section>
      </div>}
    </div>
  )
}

function PanelHead({ number, title, subtitle, state }: { number: string; title: string; subtitle: string; state: StepState }) {
  const label = state === 'done' ? '已完成' : state === 'working' ? '生成中' : state === 'ready' ? '可编辑' : '等待上一步'
  return <div className="panel-head"><div className="panel-number">{number}</div><div><h2>{title}</h2><p>{subtitle}</p></div><span className={`state ${state}`}>{label}</span></div>
}

function Choice({ selected, onClick, title, desc }: { selected: boolean; onClick: () => void; title: string; desc: string }) {
  return <button className={`choice ${selected ? 'selected' : ''}`} onClick={onClick}><span className="choice-radio" /><div><b>{title}</b><small>{desc}</small></div></button>
}

function Progress({ label, value }: { label: string; value: number }) {
  return <div className="progress-box"><div><span>{label}</span><b>{value}%</b></div><div className="progress-track"><i style={{ width: `${value}%` }} /></div><small>任务正在后台处理，请勿重复提交</small></div>
}

function SummaryRow({ label, value, state }: { label: string; value: string; state: string }) {
  return <div className="summary-row"><span>{label}</span><b className={state}>{value}</b></div>
}

export default App
