/**
 * Pixel art sprite rendering & Celeste-inspired mountain twilight arena.
 */
window.PikamonSprites = (function () {
  const starField = Array.from({ length: 42 }, (_, i) => ({
    x: ((i * 89) % 624) + 8,
    y: ((i * 47) % 155) + 8,
    size: i % 6 === 0 ? 2 : 1,
    phase: i * 0.7
  }));

  const snowMotes = Array.from({ length: 22 }, (_, i) => ({
    x0: (i * 53) % 640,
    y0: (i * 37) % 320,
    vx: 14 + (i % 4) * 5,
    vy: 8 + (i % 3) * 4,
    size: i % 5 === 0 ? 3 : 2,
    phase: i * 0.9
  }));

  /**
   * Draws a JSON-defined pixel art sprite onto a Canvas 2D context.
   */
  function drawPixelSprite(ctx, sprite, x, y, pixelSize, options = {}) {
    if (!sprite || !Array.isArray(sprite.pixels)) return;

    const {
      flipX = false,
      scaleX = 1,
      scaleY = 1,
      flashColor = null,
      alpha = 1
    } = options;

    const rows = sprite.height;
    const cols = sprite.width;
    const totalW = cols * pixelSize;
    const totalH = rows * pixelSize;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(Math.round(x), Math.round(y));
    ctx.scale((flipX ? -1 : 1) * scaleX, scaleY);

    const startX = -totalW / 2;
    const startY = -totalH;

    for (let r = 0; r < rows; r++) {
      const row = sprite.pixels[r];
      for (let c = 0; c < cols; c++) {
        const key = row[c];
        if (!key || key === '.') continue;
        const color = flashColor || sprite.palette[key];
        if (!color) continue;

        ctx.fillStyle = color;
        ctx.fillRect(
          Math.floor(startX + c * pixelSize),
          Math.floor(startY + r * pixelSize),
          Math.ceil(pixelSize),
          Math.ceil(pixelSize)
        );
      }
    }

    ctx.restore();
  }

  /**
   * Renders a creature sprite inside a small preview canvas (for draft cards & lobby).
   */
  function renderCreaturePreview(canvas, creature) {
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const sprite = creature.sprite;
    const pixelSize = Math.floor(
      Math.min(canvas.width / (sprite.width + 2), canvas.height / (sprite.height + 2))
    );
    drawPixelSprite(
      ctx,
      sprite,
      canvas.width / 2,
      canvas.height - Math.max(3, (canvas.height - sprite.height * pixelSize) / 2),
      pixelSize
    );
  }

  /**
   * Draws the Celeste-inspired twilight mountain pixel arena with aurora & snowfall.
   */
  function drawArenaBackground(ctx, width, height, timeSec) {
    // Rich twilight sky bands
    const skyBands = [
      { y: 0, h: 68, color: '#0d091c' },
      { y: 68, h: 58, color: '#171130' },
      { y: 126, h: 56, color: '#221a44' },
      { y: 182, h: 68, color: '#2e2256' },
      { y: 250, h: 110, color: '#18132d' }
    ];
    for (const band of skyBands) {
      ctx.fillStyle = band.color;
      ctx.fillRect(0, band.y, width, band.h);
    }

    // Subtle pixel aurora ribbons
    for (let x = 0; x < width; x += 8) {
      const wave = Math.sin(x * 0.025 + timeSec * 1.1) * 10;
      const y = Math.round((56 + wave) / 4) * 4;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.10)';
      ctx.fillRect(x, y, 8, 12);
      ctx.fillStyle = 'rgba(192, 132, 252, 0.08)';
      ctx.fillRect(x, y + 8, 8, 10);
    }

    // Pixel crescent moon with stepped halo
    ctx.fillStyle = 'rgba(253, 230, 138, 0.09)';
    ctx.fillRect(508, 22, 48, 48);
    ctx.fillStyle = 'rgba(253, 230, 138, 0.16)';
    ctx.fillRect(514, 28, 36, 36);
    ctx.fillStyle = '#fde68a';
    ctx.fillRect(520, 34, 24, 24);
    ctx.fillStyle = '#fef9c3';
    ctx.fillRect(524, 38, 16, 16);
    ctx.fillStyle = '#0d091c';
    ctx.fillRect(534, 34, 10, 12);

    // Twinkling pixel stars
    for (const s of starField) {
      const blink = Math.sin(timeSec * 2.4 + s.phase);
      if (blink < -0.55) continue;
      ctx.fillStyle = blink > 0.45 ? '#f8fafc' : '#94a3b8';
      ctx.fillRect(s.x, s.y, s.size * 2, s.size * 2);
    }

    // Far snow-capped mountain range (Celeste silhouette)
    drawPixelPeak(ctx, -10, 246, 200, 108, '#1d173a', '#4c467a');
    drawPixelPeak(ctx, 130, 246, 230, 138, '#231c46', '#625994');
    drawPixelPeak(ctx, 320, 246, 210, 112, '#1d173a', '#4c467a');
    drawPixelPeak(ctx, 470, 246, 210, 134, '#231c46', '#625994');

    // Mid foreground dark ridge
    drawPixelPeak(ctx, -30, 254, 210, 68, '#130f27', null);
    drawPixelPeak(ctx, 210, 254, 250, 78, '#130f27', null);
    drawPixelPeak(ctx, 430, 254, 240, 72, '#130f27', null);

    // Horizon mist glow
    ctx.fillStyle = 'rgba(125, 211, 252, 0.08)';
    ctx.fillRect(0, 236, width, 16);

    // Stone temple arena floor
    ctx.fillStyle = '#17122a';
    ctx.fillRect(0, 248, width, height - 248);
    ctx.fillStyle = '#332b57';
    ctx.fillRect(0, 248, width, 4);
    ctx.fillStyle = '#241e3f';
    ctx.fillRect(0, 252, width, 4);

    // Perspective stone tile lines
    ctx.fillStyle = '#201a38';
    for (let x = 0; x < width; x += 36) {
      ctx.fillRect(x, 256, 2, height - 256);
    }
    for (let y = 278; y < height; y += 26) {
      ctx.fillRect(0, y, width, 2);
    }

    // Drifting pixel snow motes
    for (const m of snowMotes) {
      const mx = Math.round((m.x0 + timeSec * m.vx) % width);
      const my = Math.round((m.y0 + timeSec * m.vy + Math.sin(timeSec * 2 + m.phase) * 4) % 330);
      ctx.fillStyle = 'rgba(226, 232, 240, 0.45)';
      ctx.fillRect(mx, my, m.size, m.size);
    }
  }

  function drawPixelPeak(ctx, startX, baseY, width, peakHeight, bodyColor, snowColor) {
    const step = 8;
    const half = width / 2;
    for (let dx = 0; dx < width; dx += step) {
      const dist = Math.abs(dx - half);
      const h = Math.max(0, Math.floor((((half - dist) / half) * peakHeight) / 4) * 4);
      if (h <= 0) continue;
      ctx.fillStyle = bodyColor;
      ctx.fillRect(startX + dx, baseY - h, step, h);

      if (snowColor && h > peakHeight * 0.65) {
        const capH = Math.max(4, Math.floor((h - peakHeight * 0.65) * 0.7));
        ctx.fillStyle = snowColor;
        ctx.fillRect(startX + dx, baseY - h, step, capH);
      }
    }
  }

  function drawPlatform(ctx, cx, cy, rx, ry, accentColor, isActiveTurn) {
    ctx.save();
    // Drop shadow
    ctx.fillStyle = '#0b0816';
    ctx.fillRect(cx - rx - 6, cy - ry + 6, (rx + 6) * 2, ry * 2);

    // Stone pedestal body
    ctx.fillStyle = '#2c254d';
    ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2 - 2);

    // Beveled stone top
    ctx.fillStyle = '#4f4580';
    ctx.fillRect(cx - rx + 4, cy - ry, rx * 2 - 8, 5);
    ctx.fillStyle = '#6a5ea3';
    ctx.fillRect(cx - rx + 10, cy - ry, rx * 2 - 20, 2);

    // Corner pixel moss / runes
    ctx.fillStyle = '#1b1633';
    ctx.fillRect(cx - rx + 6, cy + 2, 10, 4);
    ctx.fillRect(cx + rx - 16, cy + 2, 10, 4);

    // Elemental rim glow
    if (accentColor) {
      ctx.fillStyle = accentColor;
      ctx.globalAlpha = isActiveTurn ? 0.85 : 0.4;
      ctx.fillRect(cx - rx + 12, cy - ry + 3, rx * 2 - 24, 2);
    }

    // Active turn spotlight bracket
    if (isActiveTurn) {
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.75;
      ctx.strokeRect(cx - rx - 2, cy - ry - 2, (rx + 2) * 2, ry * 2 + 2);
    }
    ctx.restore();
  }

  return {
    drawPixelSprite,
    renderCreaturePreview,
    drawArenaBackground,
    drawPlatform
  };
})();
