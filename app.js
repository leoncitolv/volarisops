/* ==========================================================
   AppVol Launcher — app.js
   Lógica separada del index.html: tema, filtros, favoritos,
   recientes, drag & drop y service worker.
   ========================================================== */

const html = document.documentElement;
    const grid = document.getElementById('appsGrid');
    const cards = [...grid.querySelectorAll('.app-card')];
    const search = document.getElementById('searchApp');
    const chips = [...document.querySelectorAll('.chip')];
    const count = document.getElementById('appsCount');
    const empty = document.getElementById('emptyState');
    const themeBtn = document.getElementById('themeBtn');
    const modeBtn = document.getElementById('modeBtn');
    const dockButtons = [...document.querySelectorAll('.dock button')];

    const store = {
      theme: 'appvol-theme',
      density: 'appvol-density',
      favs: 'appvol-favorites',
      recent: 'appvol-recent'
    };

    let activeFilter = 'all';
    let favorites = readJSON(store.favs, []);
    let recent = readJSON(store.recent, []);

    html.dataset.theme = localStorage.getItem(store.theme) || localStorage.getItem('apone-theme') || 'dark';
    html.dataset.density = localStorage.getItem(store.density) || 'ios';
    updateThemeBtn();
    updateModeBtn();
    paintFavorites();
    applyFilters();

    themeBtn.addEventListener('click', toggleTheme);
    modeBtn.addEventListener('click', toggleMode);
    search.addEventListener('input', applyFilters);

    chips.forEach(chip => {
      chip.addEventListener('click', () => setFilter(chip.dataset.filter));
    });

    dockButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        dockButtons.forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const action = btn.dataset.dock;
        if (action === 'search') {
          search.focus();
          search.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else if (action === 'favorites') {
          setFilter('favorites');
        } else if (action === 'theme') {
          toggleTheme();
        } else {
          setFilter('all');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    });

    grid.addEventListener('click', (event) => {
      const pin = event.target.closest('.pin-btn');
      if (pin) {
        event.preventDefault();
        event.stopPropagation();
        const card = pin.closest('.app-card');
        toggleFavorite(card.dataset.id);
        return;
      }

      const link = event.target.closest('.app-link');
      if (link) {
        const card = link.closest('.app-card');
        rememberRecent(card.dataset.id);
      }
    });

    function toggleTheme() {
      html.dataset.theme = html.dataset.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem(store.theme, html.dataset.theme);
      localStorage.setItem('apone-theme', html.dataset.theme);
      updateThemeBtn();
    }

    function toggleMode() {
      html.dataset.density = html.dataset.density === 'ios' ? 'god' : 'ios';
      localStorage.setItem(store.density, html.dataset.density);
      updateModeBtn();
    }

    function updateThemeBtn() {
      themeBtn.textContent = html.dataset.theme === 'dark' ? '☀️' : '🌙';
      themeBtn.title = html.dataset.theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
    }

    function updateModeBtn() {
      modeBtn.textContent = html.dataset.density === 'ios' ? '⚡' : '📱';
      modeBtn.title = html.dataset.density === 'ios' ? 'Activar modo dios compacto' : 'Volver a modo iOS';
    }

    function setFilter(filter) {
      activeFilter = filter;
      chips.forEach(chip => chip.classList.toggle('is-active', chip.dataset.filter === filter));
      applyFilters();
    }

    function applyFilters() {
      const term = normalize(search.value);
      let visible = 0;

      cards.forEach(card => {
        const id = card.dataset.id;
        const matchesSearch = !term || normalize(card.dataset.keywords).includes(term);
        const matchesFilter =
          activeFilter === 'all' ||
          (activeFilter === 'favorites' && favorites.includes(id)) ||
          (activeFilter === 'recent' && recent.includes(id));
        const show = matchesSearch && matchesFilter;
        card.hidden = !show;
        if (show) visible += 1;
      });

      count.textContent = visible === 1 ? '1 app' : visible + ' apps';
      empty.classList.toggle('show', visible === 0);
    }

    function toggleFavorite(id) {
      favorites = favorites.includes(id) ? favorites.filter(item => item !== id) : [id, ...favorites];
      localStorage.setItem(store.favs, JSON.stringify(favorites));
      paintFavorites();
      applyFilters();
    }

    function paintFavorites() {
      cards.forEach(card => {
        const pin = card.querySelector('.pin-btn');
        const isFav = favorites.includes(card.dataset.id);
        pin.classList.toggle('is-fav', isFav);
        pin.textContent = isFav ? '★' : '☆';
      });
    }

    function rememberRecent(id) {
      recent = [id, ...recent.filter(item => item !== id)].slice(0, 4);
      localStorage.setItem(store.recent, JSON.stringify(recent));
    }

    function readJSON(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) || fallback; }
      catch { return fallback; }
    }

    function normalize(value) {
      return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .trim();
    }

    /* ── Drag & Drop reordering ── */
    const ORDER_KEY = 'appvol-card-order';

    function saveOrder() {
      const ids = [...grid.querySelectorAll('.app-card')].map(c => c.dataset.id);
      localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
    }

    function loadOrder() {
      try {
        const saved = JSON.parse(localStorage.getItem(ORDER_KEY));
        if (!Array.isArray(saved) || saved.length === 0) return;
        saved.forEach(id => {
          const card = grid.querySelector(`.app-card[data-id="${id}"]`);
          if (card) grid.appendChild(card);
        });
      } catch {}
    }

    let dragSrc = null;
    let touchDragCard = null;
    let touchClone = null;
    let touchOffsetX = 0;
    let touchOffsetY = 0;

    function initDrag(card) {
      // Desktop drag
      card.setAttribute('draggable', 'true');

      card.addEventListener('dragstart', e => {
        dragSrc = card;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        grid.querySelectorAll('.app-card').forEach(c => c.classList.remove('drag-over'));
        saveOrder();
        dragSrc = null;
      });

      card.addEventListener('dragover', e => {
        e.preventDefault();
        if (!dragSrc || dragSrc === card) return;
        e.dataTransfer.dropEffect = 'move';
        grid.querySelectorAll('.app-card').forEach(c => c.classList.remove('drag-over'));
        card.classList.add('drag-over');
      });

      card.addEventListener('dragleave', () => card.classList.remove('drag-over'));

      card.addEventListener('drop', e => {
        e.preventDefault();
        e.stopPropagation();
        if (!dragSrc || dragSrc === card) return;
        card.classList.remove('drag-over');
        const allCards = [...grid.querySelectorAll('.app-card')];
        const srcIdx = allCards.indexOf(dragSrc);
        const tgtIdx = allCards.indexOf(card);
        if (srcIdx < tgtIdx) card.after(dragSrc);
        else card.before(dragSrc);
        saveOrder();
      });

      // Touch drag
      card.addEventListener('touchstart', onTouchStart, { passive: true });
    }

    function onTouchStart(e) {
      const card = e.currentTarget;
      const touch = e.touches[0];
      const rect = card.getBoundingClientRect();
      touchOffsetX = touch.clientX - rect.left;
      touchOffsetY = touch.clientY - rect.top;

      const longPress = setTimeout(() => {
        touchDragCard = card;
        touchClone = card.cloneNode(true);
        touchClone.style.cssText = `
          position:fixed; z-index:9999; width:${rect.width}px; pointer-events:none;
          opacity:.88; transform:scale(1.04) rotate(1.5deg);
          box-shadow:0 28px 60px rgba(0,0,0,.45);
          transition:transform .12s ease;
          left:${rect.left}px; top:${rect.top}px;
        `;
        document.body.appendChild(touchClone);
        card.classList.add('dragging');
        if (navigator.vibrate) navigator.vibrate(18);
      }, 300);

      const cancelLong = () => clearTimeout(longPress);
      card.addEventListener('touchend', cancelLong, { once: true });
      card.addEventListener('touchmove', cancelLong, { once: true, passive: true });

      card.addEventListener('touchmove', onTouchMove, { passive: true });
      card.addEventListener('touchend', onTouchEnd, { once: true });
    }

    function onTouchMove(e) {
      if (!touchDragCard || !touchClone) return;
      const touch = e.touches[0];
      touchClone.style.left = (touch.clientX - touchOffsetX) + 'px';
      touchClone.style.top  = (touch.clientY - touchOffsetY) + 'px';

      touchClone.style.display = 'none';
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      touchClone.style.display = '';
      const target = el && el.closest('.app-card');
      grid.querySelectorAll('.app-card').forEach(c => c.classList.remove('drag-over'));
      if (target && target !== touchDragCard) target.classList.add('drag-over');
    }

    function onTouchEnd(e) {
      if (!touchDragCard) return;
      const touch = e.changedTouches[0];
      if (touchClone) { touchClone.remove(); touchClone = null; }
      touchDragCard.classList.remove('dragging');

      touchClone && touchClone.remove();
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const target = el && el.closest('.app-card');
      grid.querySelectorAll('.app-card').forEach(c => c.classList.remove('drag-over'));

      if (target && target !== touchDragCard) {
        const allCards = [...grid.querySelectorAll('.app-card')];
        const srcIdx = allCards.indexOf(touchDragCard);
        const tgtIdx = allCards.indexOf(target);
        if (srcIdx < tgtIdx) target.after(touchDragCard);
        else target.before(touchDragCard);
        saveOrder();
      }

      touchDragCard = null;
    }

    // Init drag on all cards
    [...grid.querySelectorAll('.app-card')].forEach(initDrag);

    // Restore saved order
    loadOrder();

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', async () => {
        try {
          const reg = await navigator.serviceWorker.register('./sw.js');

          if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });

          reg.addEventListener('updatefound', () => {
            const worker = reg.installing;
            if (!worker) return;
            worker.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                worker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });

          navigator.serviceWorker.addEventListener('message', (event) => {
            const data = event.data || {};
            if (data.type === 'APP_UPDATED') {
              const current = location.pathname.split('/').pop() || 'index.html';
              const changed = String(data.file || '').replace('./', '');
              if (changed === current || changed === 'index.html') location.reload();
            }
          });

          let refreshed = false;
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshed) return;
            refreshed = true;
            location.reload();
          });
        } catch (err) {}
      });
    }
