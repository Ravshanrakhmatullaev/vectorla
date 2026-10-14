// Shared runtime for the three design-concept prototypes: language (EN/UZ/RU),
// light/dark theme, hash routing between views, the before/after compare,
// synchronized zoom and pan, file drop/paste validation, and outline views
// built from the real traced SVGs. No framework, no build step.
;(function () {
  'use strict'

  const store = {
    get(key) {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value)
      } catch {
        // Storage can be blocked (private windows, previews): the prototype still works.
      }
    },
  }
  const params = new URLSearchParams(location.search)
  const root = document.documentElement
  const LOCALES = { en: 'en-US', uz: 'uz-Latn-UZ', ru: 'ru-RU' }
  const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
  const MAX_BYTES = 5 * 1024 * 1024

  const P = (window.Proto = {})
  P.strings = window.VL_STRINGS
  P.samples = window.VL_SAMPLES || []
  if (params.has('shot')) root.classList.add('is-shot')

  // ---------- i18n ----------
  function guessLanguage() {
    const nav = (navigator.language || 'en').slice(0, 2)
    return nav === 'ru' || nav === 'uz' ? nav : 'en'
  }
  P.lang = params.get('lang') || store.get('vlp-lang') || guessLanguage()
  if (!P.strings[P.lang]) P.lang = 'en'
  const langListeners = []

  function merge(target, extra) {
    for (const key of Object.keys(extra)) {
      const value = extra[key]
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        target[key] = target[key] || {}
        merge(target[key], value)
      } else target[key] = value
    }
  }
  P.extend = (extra) => {
    for (const lang of Object.keys(extra)) merge((P.strings[lang] = P.strings[lang] || {}), extra[lang])
  }
  function lookup(lang, key) {
    let node = P.strings[lang]
    for (const part of key.split('.')) {
      if (node == null) return undefined
      node = node[part]
    }
    return node
  }
  P.t = (key, vars) => {
    let value = lookup(P.lang, key)
    if (value === undefined) value = lookup('en', key)
    if (value === undefined) return key
    if (typeof value !== 'string' || !vars) return value
    return value.replace(/\{(\w+)\}/g, (_, name) => (vars[name] !== undefined ? String(vars[name]) : ''))
  }
  P.locale = () => LOCALES[P.lang] || 'en-US'
  P.num = (value, digits = 0) => new Intl.NumberFormat(P.locale(), { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value)
  P.kb = (bytes) => `${P.num(bytes / 1024, bytes < 10240 ? 1 : 0)} ${P.lang === 'ru' ? 'КБ' : 'KB'}`
  P.mb = (bytes) => `${P.num(bytes / 1048576, 1)} ${P.lang === 'ru' ? 'МБ' : 'MB'}`
  P.sec = (ms) => `${P.num(ms / 1000, 1)} ${P.lang === 'ru' ? 'с' : 's'}`
  P.date = (iso) => {
    try {
      return new Intl.DateTimeFormat(P.locale(), { day: 'numeric', month: 'short' }).format(new Date(iso))
    } catch {
      return iso.slice(0, 10)
    }
  }
  P.credits = (n) => {
    if (P.lang === 'uz') return `${n} kredit`
    if (P.lang === 'ru') {
      const rule = new Intl.PluralRules('ru-RU').select(n)
      return `${n} ${rule === 'one' ? 'кредит' : rule === 'few' ? 'кредита' : 'кредитов'}`
    }
    return `${n} ${n === 1 ? 'credit' : 'credits'}`
  }
  P.apply = (scope) => {
    const base = scope || document
    base.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = P.t(el.dataset.i18n)
    })
    base.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      for (const pair of el.dataset.i18nAttr.split(';')) {
        const [attr, key] = pair.split(':')
        if (attr && key) el.setAttribute(attr.trim(), P.t(key.trim()))
      }
    })
    if (!scope) {
      root.lang = P.lang
      document.querySelectorAll('[data-lang]').forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.lang === P.lang)))
      const title = P.t('meta.title')
      if (title !== 'meta.title') document.title = title
      for (const fn of langListeners) fn(P.lang)
    }
  }
  P.onLang = (fn) => langListeners.push(fn)
  P.setLang = (lang) => {
    if (!P.strings[lang]) return
    P.lang = lang
    store.set('vlp-lang', lang)
    P.apply()
  }

  // ---------- theme ----------
  const dark = window.matchMedia('(prefers-color-scheme: dark)')
  let themeChoice = params.get('theme') || store.get('vlp-theme') || root.getAttribute('data-theme') || 'system'
  P.effectiveTheme = () => {
    if (themeChoice === 'light' || themeChoice === 'dark') return themeChoice
    return P.defaultTheme === 'dark' || (P.defaultTheme !== 'light' && dark.matches) ? 'dark' : 'light'
  }
  function applyTheme() {
    const mode = P.effectiveTheme()
    // An explicit value (or a dark-first concept) sets the attribute; "system" leaves it to the media query.
    if (themeChoice === 'system' && !P.defaultTheme) root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', mode)
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => btn.setAttribute('aria-pressed', String(mode === 'dark')))
  }
  P.toggleTheme = () => {
    themeChoice = P.effectiveTheme() === 'dark' ? 'light' : 'dark'
    store.set('vlp-theme', themeChoice)
    applyTheme()
  }
  dark.addEventListener('change', applyTheme)

  // ---------- routing ----------
  const routeListeners = []
  P.onRoute = (fn) => routeListeners.push(fn)
  P.view = 'home'
  let firstRoute = true
  P.route = () => {
    const id = decodeURIComponent(location.hash.slice(1))
    const views = [...document.querySelectorAll('body > [data-view]')]
    const names = views.map((v) => v.dataset.view)
    const view = names.includes(id) ? id : 'home'
    const changed = view !== P.view || firstRoute
    P.view = view
    for (const v of views) v.hidden = v.dataset.view !== view
    root.dataset.route = view
    if (id && !names.includes(id)) {
      const target = document.getElementById(id)
      if (target) target.scrollIntoView({ block: 'start' })
    } else if (changed) {
      window.scrollTo(0, 0)
      if (!firstRoute) {
        const heading = document.querySelector(`body > [data-view="${view}"] [data-focus]`)
        if (heading) heading.focus({ preventScroll: true })
      }
    }
    for (const fn of routeListeners) fn(view, changed)
    firstRoute = false
  }
  window.addEventListener('hashchange', P.route)

  // ---------- samples ----------
  P.sample = (id) => P.samples.find((s) => s.id === id) || P.samples[0]
  P.svgUrl = (id, mode) => `samples/${id}/${mode === 'pro' ? 'pro' : 'quick'}.svg`
  P.sampleName = (id) => P.t(`samples.${id}`)
  P.sampleSource = (id) => P.t(`samples.${id}Src`)

  // ---------- compare ----------
  // <div data-compare style="--pos:50%"> layers… <input type=range> </div>
  // `handleOnly`: only the handle starts a drag (the stage pans everywhere else).
  P.compare = (el, options = {}) => {
    const range = el.querySelector('input[type="range"]')
    const handle = el.querySelector('[data-compare-handle]')
    const set = (value) => {
      const v = Math.max(0, Math.min(100, value))
      el.style.setProperty('--pos', `${v}%`)
      if (range) {
        range.value = String(Math.round(v))
        range.setAttribute('aria-valuetext', `${Math.round(v)}%`)
      }
    }
    let dragging = false
    const move = (event) => {
      const rect = el.getBoundingClientRect()
      set(((event.clientX - rect.left) / rect.width) * 100)
    }
    el.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      if (options.handleOnly && !(handle && handle.contains(event.target))) return
      dragging = true
      el.setPointerCapture(event.pointerId)
      event.stopPropagation()
      move(event)
    })
    el.addEventListener('pointermove', (event) => {
      if (dragging) move(event)
    })
    const stop = () => {
      dragging = false
    }
    el.addEventListener('pointerup', stop)
    el.addEventListener('pointercancel', stop)
    if (range) range.addEventListener('input', () => set(Number(range.value)))
    set(range ? Number(range.value) : 50)
    return { set }
  }

  // ---------- stage: synchronized zoom and pan over one or more viewports ----------
  // Each viewport holds one `.stage-content` sized to the image (width/height,
  // so SVGs re-rasterize crisply) and translated for panning.
  P.stage = (viewports, options = {}) => {
    let natW = 1
    let natH = 1
    let scale = 1
    let fitScale = 1
    let x = 0
    let y = 0
    let userMoved = false
    const contents = viewports.map((vp) => vp.querySelector('.stage-content'))
    const primary = () => viewports.find((vp) => vp.offsetParent !== null) || viewports[0]
    const layout = () => {
      for (const c of contents) {
        c.style.width = `${natW * scale}px`
        c.style.height = `${natH * scale}px`
        c.style.transform = `translate(${x}px, ${y}px)`
      }
      for (const vp of viewports) vp.classList.toggle('is-pixels', scale / (options.pixelRatio ? options.pixelRatio() : 1) >= 2)
      if (options.onZoom) options.onZoom(scale, fitScale)
    }
    const fit = () => {
      const rect = primary().getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const raw = typeof options.padding === 'function' ? options.padding() : options.padding !== undefined ? options.padding : 32
      const pad = typeof raw === 'number' ? { x: raw, y: raw } : raw
      fitScale = Math.max(0.01, Math.min((rect.width - pad.x * 2) / natW, (rect.height - pad.y * 2) / natH))
      scale = fitScale
      x = (rect.width - natW * scale) / 2
      y = (rect.height - natH * scale) / 2
      userMoved = false
      layout()
    }
    const zoomAt = (factor, cx, cy) => {
      const rect = primary().getBoundingClientRect()
      const px = cx === undefined ? rect.width / 2 : cx
      const py = cy === undefined ? rect.height / 2 : cy
      const next = Math.max(fitScale * 0.5, Math.min(48, scale * factor))
      const k = next / scale
      x = px - (px - x) * k
      y = py - (py - y) * k
      scale = next
      userMoved = true
      layout()
    }
    const pointers = new Map()
    let pinchStart = null
    for (const vp of viewports) {
      vp.addEventListener(
        'wheel',
        (event) => {
          event.preventDefault()
          const rect = vp.getBoundingClientRect()
          zoomAt(Math.exp(-event.deltaY * 0.0016), event.clientX - rect.left, event.clientY - rect.top)
        },
        { passive: false },
      )
      vp.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.target.closest('[data-no-pan]')) return
        vp.setPointerCapture(event.pointerId)
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()]
          pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), scale }
        }
        vp.classList.add('is-panning')
      })
      vp.addEventListener('pointermove', (event) => {
        const prev = pointers.get(event.pointerId)
        if (!prev) return
        const now = { x: event.clientX, y: event.clientY }
        pointers.set(event.pointerId, now)
        if (pointers.size === 2 && pinchStart) {
          const [a, b] = [...pointers.values()]
          const rect = vp.getBoundingClientRect()
          const target = (pinchStart.scale * Math.hypot(a.x - b.x, a.y - b.y)) / pinchStart.d
          zoomAt(target / scale, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top)
        } else if (pointers.size === 1) {
          x += now.x - prev.x
          y += now.y - prev.y
          userMoved = true
          layout()
        }
      })
      const end = (event) => {
        pointers.delete(event.pointerId)
        if (pointers.size < 2) pinchStart = null
        if (!pointers.size) vp.classList.remove('is-panning')
      }
      vp.addEventListener('pointerup', end)
      vp.addEventListener('pointercancel', end)
      vp.addEventListener('keydown', (event) => {
        const step = 40
        const keys = {
          '+': () => zoomAt(1.25),
          '=': () => zoomAt(1.25),
          '-': () => zoomAt(0.8),
          0: () => fit(),
          ArrowLeft: () => ((x += step), layout()),
          ArrowRight: () => ((x -= step), layout()),
          ArrowUp: () => ((y += step), layout()),
          ArrowDown: () => ((y -= step), layout()),
        }
        const action = keys[event.key]
        if (action && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault()
          userMoved = true
          action()
        }
      })
    }
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => {
        if (!userMoved) fit()
      })
      for (const vp of viewports) observer.observe(vp)
    }
    return {
      setSize(w, h) {
        natW = w
        natH = h
        fit()
      },
      fit,
      zoomAt,
      actual() {
        zoomAt((options.pixelRatio ? options.pixelRatio() : 1) / scale)
      },
      get scale() {
        return scale
      },
    }
  }

  // ---------- files: drop, browse, paste ----------
  P.validate = (file) => {
    if (!file) return 'upload.invalidType'
    const name = (file.name || '').toLowerCase()
    const typeOk = ALLOWED_TYPES.includes(file.type) || /\.(png|jpe?g|webp)$/.test(name)
    if (!typeOk) return 'upload.invalidType'
    if (file.size > MAX_BYTES) return 'upload.tooLarge'
    return null
  }
  const fileHandlers = []
  P.onFile = (fn) => fileHandlers.push(fn)
  const deliver = (file) => {
    const error = P.validate(file)
    for (const fn of fileHandlers) fn(file, error)
  }
  P.dropzone = (el) => {
    const input = el.querySelector('input[type="file"]')
    el.querySelectorAll('[data-browse]').forEach((btn) =>
      btn.addEventListener('click', (event) => {
        event.preventDefault()
        if (input) input.click()
      }),
    )
    if (input)
      input.addEventListener('change', () => {
        if (input.files && input.files[0]) deliver(input.files[0])
        input.value = ''
      })
    el.addEventListener('dragover', (event) => {
      event.preventDefault()
      el.classList.add('is-over')
    })
    el.addEventListener('dragleave', () => el.classList.remove('is-over'))
    el.addEventListener('drop', (event) => {
      event.preventDefault()
      event.stopPropagation()
      el.classList.remove('is-over')
      document.querySelectorAll('[data-drop-overlay]').forEach((o) => (o.hidden = true))
      depth = 0
      if (event.dataTransfer && event.dataTransfer.files[0]) deliver(event.dataTransfer.files[0])
    })
  }
  // Dropping anywhere on the page, with an overlay while files are dragged in.
  let depth = 0
  const hasFiles = (event) => event.dataTransfer && [...event.dataTransfer.types].includes('Files')
  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return
    depth++
    document.querySelectorAll('[data-drop-overlay]').forEach((o) => (o.hidden = false))
  })
  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return
    depth = Math.max(0, depth - 1)
    if (!depth) document.querySelectorAll('[data-drop-overlay]').forEach((o) => (o.hidden = true))
  })
  window.addEventListener('dragover', (event) => {
    if (hasFiles(event)) event.preventDefault()
  })
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    depth = 0
    document.querySelectorAll('[data-drop-overlay]').forEach((o) => (o.hidden = true))
    if (event.dataTransfer.files[0]) deliver(event.dataTransfer.files[0])
  })
  document.addEventListener('paste', (event) => {
    const items = event.clipboardData ? [...event.clipboardData.items] : []
    const item = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'))
    if (item) deliver(item.getAsFile())
  })

  // ---------- inline SVGs: outlines and anchor points ----------
  const svgCache = new Map()
  P.svgText = (url) => {
    if (!svgCache.has(url)) svgCache.set(url, fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))))
    return svgCache.get(url)
  }
  P.inlineSvg = async (url, prefix) => {
    const text = await P.svgText(url)
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
    const svg = doc.documentElement
    // Gradient ids would collide between inlined traces.
    svg.querySelectorAll('[id]').forEach((el) => el.setAttribute('id', prefix + el.id))
    svg.querySelectorAll('[fill^="url(#"]').forEach((el) => el.setAttribute('fill', el.getAttribute('fill').replace('url(#', `url(#${prefix}`)))
    svg.removeAttribute('width')
    svg.removeAttribute('height')
    svg.setAttribute('preserveAspectRatio', 'none')
    svg.setAttribute('aria-hidden', 'true')
    return document.importNode(svg, true)
  }
  // The end point of every path segment, as one path of zero-length strokes:
  // with a square cap and a non-scaling stroke each draws a fixed-size square.
  P.anchorPath = (svg) => {
    const out = []
    const token = /[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g
    const arity = { m: 2, l: 2, c: 6, h: 1, v: 1, s: 4, q: 4, t: 2 }
    svg.querySelectorAll('path').forEach((path) => {
      if (path.getAttribute('fill') === 'none') return
      const parts = (path.getAttribute('d') || '').match(token) || []
      let cx = 0
      let cy = 0
      let sx = 0
      let sy = 0
      let cmd = ''
      let args = []
      const flush = () => {
        const lower = cmd.toLowerCase()
        const rel = cmd === lower
        if (lower === 'm' || lower === 'l' || lower === 't') {
          cx = rel ? cx + args[0] : args[0]
          cy = rel ? cy + args[1] : args[1]
          if (lower === 'm') {
            sx = cx
            sy = cy
          }
        } else if (lower === 'c' || lower === 's' || lower === 'q') {
          const n = args.length
          cx = rel ? cx + args[n - 2] : args[n - 2]
          cy = rel ? cy + args[n - 1] : args[n - 1]
        } else if (lower === 'h') cx = rel ? cx + args[0] : args[0]
        else if (lower === 'v') cy = rel ? cy + args[0] : args[0]
        out.push(`M${Math.round(cx * 10) / 10} ${Math.round(cy * 10) / 10}h0`)
        // Extra pairs after a moveto are linetos.
        if (lower === 'm') cmd = rel ? 'l' : 'L'
        args = []
      }
      for (const part of parts) {
        if (/[a-zA-Z]/.test(part)) {
          cmd = part
          args = []
          if (part === 'z' || part === 'Z') {
            cx = sx
            cy = sy
          }
          continue
        }
        args.push(Number(part))
        if (args.length === arity[cmd.toLowerCase()]) flush()
      }
    })
    return out.join('')
  }

  // ---------- small DOM helper ----------
  P.h = (tag, attrs, ...children) => {
    const el = document.createElement(tag)
    // `loading` must be set before `src`, or the image starts loading eagerly.
    const entries = Object.entries(attrs || {}).sort(([a], [b]) => (a === 'loading' ? -1 : b === 'loading' ? 1 : 0))
    for (const [key, value] of entries) {
      if (value === false || value === null || value === undefined) continue
      if (key === 'class') el.className = value
      else if (key === 'text') el.textContent = value
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value)
      else el.setAttribute(key, value === true ? '' : value)
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child)
    return el
  }

  // ---------- boot ----------
  P.init = (options = {}) => {
    P.defaultTheme = options.defaultTheme
    if (!params.get('theme') && !store.get('vlp-theme') && options.defaultTheme) themeChoice = 'system'
    applyTheme()
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => btn.addEventListener('click', P.toggleTheme))
    document.querySelectorAll('[data-lang]').forEach((btn) => btn.addEventListener('click', () => P.setLang(btn.dataset.lang)))
    document.querySelectorAll('[data-dropzone]').forEach((el) => P.dropzone(el))
    P.apply()
    P.route()
  }
})()
