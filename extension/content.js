;(function () {
  'use strict'

  // ---------------------------------------------------------------------------
  // Bounds — content script
  // Detects when a PDF is selected for upload on any website and prompts the
  // user to scan it for sensitive data first. No text extraction, no scanning —
  // just a privacy nudge before the file leaves the device.
  // ---------------------------------------------------------------------------

  function showOverlay(fileName) {
    document.getElementById('bounds-overlay')?.remove()

    const el = document.createElement('div')
    el.id = 'bounds-overlay'
    el.setAttribute('role', 'alert')
    el.innerHTML = `
      <div class="bounds-header">
        <div class="bounds-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </div>
        <div class="bounds-body">
          <p class="bounds-title">Uploading a PDF?</p>
          <p class="bounds-sub">Check <em class="bounds-filename"></em> for sensitive data before it leaves your device.</p>
        </div>
        <button class="bounds-close" aria-label="Dismiss">×</button>
      </div>
      <div class="bounds-actions">
        <button class="bounds-btn-primary">Scan with b.ounds. Free &amp; offline.</button>
        <button class="bounds-btn-secondary">Upload anyway</button>
      </div>
    `

    el.querySelector('.bounds-filename').textContent = fileName

    el.querySelector('.bounds-btn-primary').addEventListener('click', () => {
      window.open('https://bounds.aqta.ai', '_blank')
      el.remove()
    })
    el.querySelector('.bounds-btn-secondary').addEventListener('click', () => el.remove())
    el.querySelector('.bounds-close').addEventListener('click', () => el.remove())

    document.documentElement.appendChild(el)
    setTimeout(() => el?.remove(), 30_000)
  }

  document.addEventListener('change', (e) => {
    const input = e.target
    if (!(input instanceof HTMLInputElement) || input.type !== 'file') return

    const pdfs = Array.from(input.files || []).filter(
      f => f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf'
    )
    if (pdfs.length === 0) return

    // Show for the first PDF — if multiple, note the count
    const name = pdfs.length === 1
      ? pdfs[0].name
      : `${pdfs[0].name} + ${pdfs.length - 1} more`

    showOverlay(name)
  }, true)

})()
