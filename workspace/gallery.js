const GALLERY = document.getElementById('gallery');
const TAGSBAR = document.getElementById('tagsBar');
const SEARCH = document.getElementById('search');
const TAGFILTER = document.getElementById('tagFilter');
const CLEAR = document.getElementById('clear');
const NSFW_TOGGLE = document.getElementById('nsfwToggle');

let items = [];
let activeTag = '';
let searchQuery = '';
let currentDisplay = [];
let currentIndex = -1;
let previousActiveElement = null;
let _lightboxKeyHandler = null;
let _ariaHiddenNodes = [];
let tagsExpanded = false;
let nsfwUnblurred = {};
let nsfwGlobalToggle = false;

async function load() {
  try {
    const res = await fetch('./images.json');
    items = await res.json();
  } catch (e) {
    GALLERY.innerHTML = '<div class="empty">Missing or invalid images.json</div>';
    return;
  }
  // sort newest first by dateAdded
  items.sort((a,b) => new Date(b.dateAdded) - new Date(a.dateAdded));
  renderTags();
  render();
}

function renderTags(){
  // build counts for each tag
  const counts = {};
  items.forEach(i => (i.tags||[]).forEach(t => { counts[t] = (counts[t]||0) + 1; }));
  const tags = Object.keys(counts);
  if(tags.length === 0){ TAGSBAR.innerHTML = ''; return; }

  // top tags by frequency (desc), tie-breaker alphabetical
  const byCount = tags.slice().sort((a,b) => (counts[b] - counts[a]) || a.localeCompare(b));
  const topSeven = byCount.slice(0,7);
  // all tags alphabetical
  const allAlpha = tags.slice().sort((a,b)=> a.localeCompare(b));

  const toShow = tagsExpanded ? allAlpha : topSeven;

  TAGSBAR.innerHTML = toShow.map(t => `<div class="tag" data-tag="${t}">${escapeHtml(t)} <span class="tag-count">(${counts[t]})</span></div>`).join('');

  // add show more / show less button when there are more than 7 tags
  if(tags.length > 7){
    const btnText = tagsExpanded ? 'Show less' : `Show more (${tags.length - 7})`;
    TAGSBAR.innerHTML += `<button id="showMoreTags" class="tags-showmore" aria-expanded="${tagsExpanded}">${btnText}</button>`;
  }

  // attach tag click handlers inside tags bar
  TAGSBAR.querySelectorAll('.tag').forEach(el=>{
    el.addEventListener('click', () => {
      activeTag = el.dataset.tag;
      TAGFILTER.value = activeTag;
      updateActiveTagUI();
      render();
    });
  });

  const showBtn = document.getElementById('showMoreTags');
  if(showBtn){
    showBtn.addEventListener('click', ()=>{ tagsExpanded = !tagsExpanded; renderTags(); });
  }
  // make sure active tag stays highlighted if present
  updateActiveTagUI();
}

function updateActiveTagUI(){
  TAGSBAR.querySelectorAll('.tag').forEach(el=>{
    el.classList.toggle('active', el.dataset.tag === activeTag);
  });
}

function render(){
  searchQuery = SEARCH.value.trim().toLowerCase();
  const tag = TAGFILTER.value.trim();
  if(tag !== activeTag) activeTag = tag || '';
  const filtered = items.filter(i=>{
    if (activeTag && !(i.tags||[]).includes(activeTag)) return false;
    if (searchQuery && !(i.title||'').toLowerCase().includes(searchQuery)) return false;
    return true;
  });
  // store currently displayed list so lightbox navigation can use it
  currentDisplay = filtered;
  if(filtered.length === 0){
    GALLERY.innerHTML = '<div class="empty">No images match the filters.</div>';
    return;
  }
  GALLERY.innerHTML = filtered.map((i, idx) => `
    <article class="card${(i.tags||[]).includes('nsfw') ? ' has-nsfw' : ''}">
      <button class="unblur-btn" data-index="${idx}">View NSFW</button>
      <img class="thumb${(i.tags||[]).includes('nsfw') ? ' nsfw-blur' : ''}" data-index="${idx}" src="./images/${encodeURIComponent(i.filename)}" alt="${escapeHtml(i.title||'')}" />
      <div class="meta">
        <div class="title">${escapeHtml(i.title||i.filename)}</div>
        <div class="tags">${(i.tags||[]).map(t=>`<span class="tag" data-tag="${t}">${t}</span>`).join('')}</div>
      </div>
    </article>
  `).join('');
  // attach tag click handlers inside cards
  GALLERY.querySelectorAll('.tag').forEach(el=>{
    el.addEventListener('click', (e)=>{
      const t = el.dataset.tag;
      TAGFILTER.value = t;
      activeTag = t;
      updateActiveTagUI();
      render();
      e.stopPropagation();
    });
  });

  // attach unblur button handlers
  GALLERY.querySelectorAll('.unblur-btn').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      nsfwUnblurred[idx] = true;
      updateThumbnailNsfw();
    });
  });

  // attach click handlers to thumbnails to open lightbox
  GALLERY.querySelectorAll('.thumb').forEach(el=>{
    el.addEventListener('click', (e)=>{
      const idx = parseInt(el.dataset.index, 10);
      openLightboxByIndex(idx);
    });
  });
}

function escapeHtml(s){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function updateThumbnailNsfw(){
  GALLERY.querySelectorAll('.card.has-nsfw').forEach(card => {
    const thumb = card.querySelector('.thumb');
    const idx = parseInt(thumb.dataset.index, 10);
    const isUnblurred = nsfwUnblurred[idx] || nsfwGlobalToggle;
    thumb.classList.toggle('nsfw-blur', !isUnblurred);
    card.classList.toggle('unblurred', isUnblurred);
  });
}

SEARCH.addEventListener('input', render);
TAGFILTER.addEventListener('input', ()=>{ activeTag = TAGFILTER.value.trim(); updateActiveTagUI(); render(); });
CLEAR.addEventListener('click', ()=>{ SEARCH.value=''; TAGFILTER.value=''; activeTag=''; updateActiveTagUI(); render(); });

// Lightbox / lightbox controls
const LIGHTBOX = document.getElementById('lightbox');
const LIGHTBOX_IMG = document.getElementById('lightbox-img');
const LIGHTBOX_CAP = document.getElementById('lightbox-caption');
const LIGHTBOX_CLOSE = document.querySelector('.lightbox-close');
const LIGHTBOX_PREV = document.querySelector('.lightbox-prev');
const LIGHTBOX_NEXT = document.querySelector('.lightbox-next');
const NSFW_WARNING = document.getElementById('nsfw-warning');
const VIEW_NSFW_BTN = document.getElementById('viewNsfwBtn');

function openLightboxByIndex(idx){
  if(!LIGHTBOX) return;
  if(!Array.isArray(currentDisplay) || idx < 0 || idx >= currentDisplay.length) return;
  const item = currentDisplay[idx];
  const src = `./images/${encodeURIComponent(item.filename)}`;
  LIGHTBOX_IMG.src = src;
  LIGHTBOX_IMG.alt = item.title || item.filename || '';
  LIGHTBOX_CAP.textContent = item.title || item.filename || '';
  LIGHTBOX.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  currentIndex = idx;

  // check if image has nsfw tag and blur accordingly
  const isNsfw = (item.tags||[]).includes('nsfw');
  const isUnblurred = nsfwUnblurred[idx] || nsfwGlobalToggle;
  if(isNsfw){
    LIGHTBOX_IMG.classList.toggle('nsfw-blur', !isUnblurred);
    NSFW_WARNING.style.display = isUnblurred ? 'none' : 'block';
  } else {
    LIGHTBOX_IMG.classList.remove('nsfw-blur');
    NSFW_WARNING.style.display = 'none';
  }

  // save previously focused element so we can restore on close
  previousActiveElement = document.activeElement;

  // hide other page content from assistive tech while dialog is open
  _ariaHiddenNodes = [];
  Array.from(document.body.children).forEach(child => {
    if (child === LIGHTBOX) return;
    const prev = child.getAttribute('aria-hidden');
    _ariaHiddenNodes.push({ el: child, prev });
    try { child.setAttribute('aria-hidden', 'true'); } catch (e) {}
  });
  try { LIGHTBOX.setAttribute('aria-hidden', 'false'); } catch (e) {}

  // focus the close button (or first focusable) and install focus-trap key handler
  setTimeout(()=>{
    const focusable = Array.from(LIGHTBOX.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(el => !el.hasAttribute('disabled'));
    // Prefer focusing the image, then the close button, then the first focusable.
    const firstFocusable = (LIGHTBOX_IMG && typeof LIGHTBOX_IMG.focus === 'function') ? LIGHTBOX_IMG : LIGHTBOX_CLOSE || focusable[0];
    try{ firstFocusable && firstFocusable.focus(); }catch(e){}
  }, 10);

  // trap focus inside the lightbox
  _lightboxKeyHandler = function(e){
    if(e.key !== 'Tab') return;
    const focusable = Array.from(LIGHTBOX.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(el => !el.hasAttribute('disabled'));
    if(focusable.length === 0){ e.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
  };
  LIGHTBOX.addEventListener('keydown', _lightboxKeyHandler);
}

function showPrev(){
  if(currentDisplay.length === 0) return;
  const next = (currentIndex - 1 + currentDisplay.length) % currentDisplay.length;
  openLightboxByIndex(next);
}

function showNext(){
  if(currentDisplay.length === 0) return;
  const next = (currentIndex + 1) % currentDisplay.length;
  openLightboxByIndex(next);
}

function closeLightbox(){
  if(!LIGHTBOX) return;
  LIGHTBOX.classList.add('hidden');
  LIGHTBOX_IMG.src = '';
  LIGHTBOX_CAP.textContent = '';
  document.body.style.overflow = '';
  currentIndex = -1;
  // remove focus trap and restore previous focus
  if(_lightboxKeyHandler) LIGHTBOX.removeEventListener('keydown', _lightboxKeyHandler);
  _lightboxKeyHandler = null;
  // restore aria-hidden on previously-hidden nodes
  try{
    _ariaHiddenNodes.forEach(({ el, prev }) => {
      if (prev === null) el.removeAttribute('aria-hidden'); else el.setAttribute('aria-hidden', prev);
    });
  }catch(e){}
  _ariaHiddenNodes = [];

  try{ if(previousActiveElement && typeof previousActiveElement.focus === 'function') previousActiveElement.focus(); }catch(e){}
  previousActiveElement = null;
  try { LIGHTBOX.setAttribute('aria-hidden', 'true'); } catch (e) {}
}

if(LIGHTBOX_CLOSE) LIGHTBOX_CLOSE.addEventListener('click', closeLightbox);
if(LIGHTBOX_PREV) LIGHTBOX_PREV.addEventListener('click', (e)=>{ e.stopPropagation(); showPrev(); });
if(LIGHTBOX_NEXT) LIGHTBOX_NEXT.addEventListener('click', (e)=>{ e.stopPropagation(); showNext(); });
if(LIGHTBOX) LIGHTBOX.addEventListener('click', (e)=>{ if(e.target === LIGHTBOX) closeLightbox(); });

// handle nsfw view button
if(VIEW_NSFW_BTN){
  VIEW_NSFW_BTN.addEventListener('click', ()=>{
    nsfwUnblurred[currentIndex] = true;
    LIGHTBOX_IMG.classList.remove('nsfw-blur');
    NSFW_WARNING.style.display = 'none';
  });
}

// handle global nsfw toggle
if(NSFW_TOGGLE){
  NSFW_TOGGLE.addEventListener('change', ()=>{
    nsfwGlobalToggle = NSFW_TOGGLE.checked;
    updateThumbnailNsfw();
  });
}

window.addEventListener('keydown', (e)=>{
  if(!LIGHTBOX || LIGHTBOX.classList.contains('hidden')) return;
  if(e.key === 'Escape') closeLightbox();
  if(e.key === 'ArrowLeft') showPrev();
  if(e.key === 'ArrowRight') showNext();
});

load();