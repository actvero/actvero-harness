/** Animate the approved login artwork; use its still image when motion is disabled or WebGL fails. */
(() => {
  const vertex = 'attribute vec2 position; varying vec2 vUv; void main(){vUv=position*0.5+0.5;gl_Position=vec4(position,0.0,1.0);}'
  const fragment = `precision highp float;
    uniform sampler2D uImage; uniform vec2 uCover; uniform float uTime; varying vec2 vUv;
    vec2 current(vec2 p,float t){
      float x=sin(p.y*5.0+p.x*2.0+t*0.55)+0.45*sin(p.y*9.0-p.x*3.0-t*0.38);
      float y=cos(p.x*5.0-p.y*2.0+t*0.42)+0.4*sin(p.x*8.0+p.y*5.0-t*0.31);
      return vec2(x,y);
    }
    void main(){
      vec2 uv=vUv;
      float edge=smoothstep(0.0,0.15,uv.x)*smoothstep(0.0,0.15,1.0-uv.x);
      edge*=smoothstep(0.0,0.12,uv.y)*smoothstep(0.0,0.12,1.0-uv.y);
      float depth=mix(0.22,1.0,1.0-smoothstep(0.2,0.9,uv.y));
      uv+=(current(uv,uTime)-current(uv,0.0))*vec2(0.032,0.021)*edge*depth;
      gl_FragColor=texture2D(uImage,(uv-0.5)*uCover+0.5);
    }`
  const mount = (host) => {
    const image = host.querySelector('img')
    if (!image) return () => {}
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    canvas.hidden = true
    host.appendChild(canvas)
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const shaders = []
    let gl, program, buffer, texture, timeUniform, coverUniform
    let ready = false, failed = false, disposed = false, inView = true, frame = 0, previous = 0, elapsed = 0
    const stop = () => { cancelAnimationFrame(frame); frame = 0; previous = 0 }
    const draw = () => { gl.uniform1f(timeUniform, elapsed); gl.drawArrays(gl.TRIANGLES, 0, 3) }
    const animate = (now) => {
      frame = requestAnimationFrame(animate)
      if (!previous) previous = now
      const delta = now - previous
      if (delta < 1000 / 30) return
      elapsed += Math.min(delta / 1000, 0.1)
      previous = now
      draw()
    }
    const sync = () => {
      stop()
      canvas.hidden = reduced.matches || !ready || failed
      host.dataset.motion = failed ? 'unavailable' : reduced.matches ? 'reduced-motion' : !ready ? 'loading' : document.hidden || !inView ? 'hidden' : 'running'
      if (!canvas.hidden && !document.hidden && inView && !disposed) { draw(); frame = requestAnimationFrame(animate) }
    }
    const resize = () => {
      if (!ready || disposed) return
      const {width, height} = host.getBoundingClientRect()
      if (!width || !height) return
      const dpr = Math.min(devicePixelRatio || 1, 1.5)
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr)
      gl.viewport(0, 0, canvas.width, canvas.height)
      const aspect = width / height, imageAspect = image.naturalWidth / image.naturalHeight
      gl.uniform2f(coverUniform, Math.min(1, aspect / imageAspect), Math.min(1, imageAspect / aspect))
      if (!document.hidden && inView) draw()
    }
    const load = () => {
      if (disposed || ready || failed) return
      try {
        gl = canvas.getContext('webgl', {depth:false, stencil:false, antialias:false, powerPreference:'low-power'})
        if (!gl) throw new Error('No WebGL')
        program = gl.createProgram()
        for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
          const shader = gl.createShader(type); shaders.push(shader)
          gl.shaderSource(shader, source); gl.compileShader(shader)
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Invalid shader')
          gl.attachShader(program, shader)
        }
        gl.linkProgram(program)
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Invalid program')
        gl.useProgram(program)
        buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW)
        const position = gl.getAttribLocation(program, 'position')
        gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
        texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
        gl.uniform1i(gl.getUniformLocation(program, 'uImage'), 0)
        timeUniform = gl.getUniformLocation(program, 'uTime'); coverUniform = gl.getUniformLocation(program, 'uCover')
        ready = true; resize(); sync()
      } catch { failed = true; sync() }
    }
    const error = () => { failed = true; sync() }
    const lost = (event) => { event.preventDefault(); error() }
    const resizeObserver = new ResizeObserver(resize)
    const visibility = new IntersectionObserver((entries) => { inView = entries[0]?.isIntersecting ?? false; sync() })
    resizeObserver.observe(host); visibility.observe(host)
    document.addEventListener('visibilitychange', sync)
    reduced.addEventListener('change', sync)
    image.addEventListener('load', load); image.addEventListener('error', error)
    canvas.addEventListener('webglcontextlost', lost)
    if (image.complete && image.naturalWidth) load()
    else sync()
    return () => {
      disposed = true; stop(); resizeObserver.disconnect(); visibility.disconnect()
      document.removeEventListener('visibilitychange', sync); reduced.removeEventListener('change', sync)
      image.removeEventListener('load', load); image.removeEventListener('error', error)
      canvas.removeEventListener('webglcontextlost', lost)
      if (gl) {
        if (buffer) gl.deleteBuffer(buffer)
        if (texture) gl.deleteTexture(texture)
        for (const shader of shaders) gl.deleteShader(shader)
        if (program) gl.deleteProgram(program)
        gl.getExtension('WEBGL_lose_context')?.loseContext()
      }
      canvas.remove()
    }
  }
  const active = new Map()
  const reconcile = () => {
    for (const [host, dispose] of active) if (!host.isConnected) { dispose(); active.delete(host) }
    for (const host of document.querySelectorAll('[data-actvero-atmosphere]')) if (!active.has(host)) active.set(host, mount(host))
  }
  const observer = new MutationObserver(reconcile)
  observer.observe(document.documentElement, {childList:true, subtree:true})
  reconcile()
  window.addEventListener('pagehide', () => { observer.disconnect(); for (const dispose of active.values()) dispose(); active.clear() }, {once:true})
})()
