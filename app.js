const seedItems = [
  { id: 1, title: 'The Left Hand of Darkness', creator: 'Ursula K. Le Guin', type: 'book', year: '1969', color: 'plum', favorite: true, added: '2026-09-02' },
  { id: 2, title: 'In the Mood for Love', creator: 'Wong Kar-wai', type: 'movie', year: '2000', color: 'orange', favorite: false, added: '2026-08-29' },
  { id: 3, title: 'Promises', creator: 'Floating Points', type: 'music', year: '2021', color: 'teal', favorite: true, added: '2026-08-18' },
  { id: 4, title: 'The Shape of Water', creator: 'Guillermo del Toro', type: 'movie', year: '2017', color: 'navy', favorite: false, added: '2026-08-04' },
  { id: 5, title: 'The Goldfinch', creator: 'Donna Tartt', type: 'book', year: '2013', color: 'mustard', favorite: false, added: '2026-07-28' },
  { id: 6, title: 'Blue', creator: 'Joni Mitchell', type: 'music', year: '1971', color: 'navy', favorite: false, added: '2026-07-14' }
];
let items = JSON.parse(localStorage.getItem('shelf-it-items') || 'null') || seedItems;
let activeView = 'all';
let searchTerm = '';
const $ = (selector) => document.querySelector(selector);
const typeNames = { all: 'All media', book: 'Books', movie: 'Movies', music: 'Music' };
const typeLabels = { book: 'Book', movie: 'Film', music: 'Record' };
function save() { localStorage.setItem('shelf-it-items', JSON.stringify(items)); }
function render() {
  const isProfile = activeView === 'profile';
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === activeView));
  $('.intro').hidden = isProfile;
  $('.stats').hidden = isProfile;
  $('.library-section').hidden = isProfile;
  $('#profileView').hidden = !isProfile;
  if (isProfile) { renderProfile(); return; }
  const filtered = items.filter((item) => (activeView === 'all' || item.type === activeView) && `${item.title} ${item.creator}`.toLowerCase().includes(searchTerm.toLowerCase()));
  $('#shelfGrid').innerHTML = filtered.length ? filtered.map(cardTemplate).join('') : '<div class="empty-state"><strong>Nothing here yet.</strong><p>Try another filter or add a new piece to your shelf.</p></div>';
  $('#sectionTitle').textContent = activeView === 'all' ? 'Everything on your shelf' : `${typeNames[activeView]} on your shelf`;
  $('#sectionSubtitle').textContent = searchTerm ? `Results for “${searchTerm}”.` : activeView === 'all' ? 'The full collection, in one place.' : `Your ${typeNames[activeView].toLowerCase()} collection.`;
  $('#breadcrumbView').textContent = typeNames[activeView];
  $('#totalStat').textContent = items.length;
  $('#favoriteStat').textContent = items.filter((item) => item.favorite).length;
  $('#recentStat').textContent = items.filter((item) => item.added.startsWith('2026-09')).length;
  $('#progressNumber').textContent = items.length;
  $('#progressBar').style.width = `${Math.min(items.length / 24 * 100, 100)}%`;
  ['all', 'book', 'movie', 'music'].forEach((type) => { const count = type === 'all' ? items.length : items.filter((item) => item.type === type).length; $(`#${type === 'all' ? 'all' : type}Count`).textContent = count; });
  document.querySelectorAll('.filter-chip').forEach((button) => button.classList.toggle('active', button.dataset.filter === activeView));
}
function renderProfile() {
  const favorites = items.filter((item) => item.favorite);
  const recent = [...items].sort((a, b) => b.id - a.id).slice(0, 4);
  $('#breadcrumbView').textContent = 'Profile';
  $('#profileView').innerHTML = `<div class="profile-hero"><div class="profile-avatar">NC</div><div class="profile-copy"><p class="eyebrow">PUBLIC PROFILE</p><h1>Nick's shelf</h1><p>Collecting stories, sounds, and scenes worth keeping close.</p><div class="profile-meta"><span>@nick</span><span>•</span><span>Chicago, IL</span><span>•</span><span>Member since 2026</span></div></div><button class="outline-button">Share profile <span>↗</span></button></div><div class="profile-stats"><div><strong>${items.length}</strong><span>on shelf</span></div><div><strong>${favorites.length}</strong><span>favorites</span></div><div><strong>18</strong><span>following</span></div><div><strong>42</strong><span>followers</span></div></div><div class="profile-columns"><section><div class="profile-heading"><div><p class="eyebrow">THE SHORTLIST</p><h2>Favorites</h2></div><button class="text-button">See all <span>→</span></button></div><div class="favorite-shelf">${favorites.length ? favorites.map(cardTemplate).join('') : '<div class="empty-state"><strong>Your favorites are waiting.</strong><p>Star the things that define your taste.</p></div>'}</div></section><aside class="activity-panel"><div class="profile-heading"><div><p class="eyebrow">WHAT'S NEW</p><h2>Recent activity</h2></div></div>${recent.map((item) => `<div class="activity-item"><div class="activity-thumb ${item.color}">${typeLabels[item.type][0]}</div><div><p>Added <strong>${item.title}</strong></p><span>${item.creator} · ${typeLabels[item.type]}</span></div><time>${item.year}</time></div>`).join('')}<button class="follow-button">Find people to follow <span>→</span></button></aside></div>`;
}
function cardTemplate(item) { return `<article class="media-card"><div class="cover ${item.color}"><div class="cover-top"><span class="cover-type">${typeLabels[item.type]} / ${item.year || '—'}</span></div><button class="favorite ${item.favorite ? 'is-favorite' : ''}" data-favorite="${item.id}" aria-label="${item.favorite ? 'Remove from' : 'Add to'} favorites">${item.favorite ? '*' : '+'}</button><button class="remove-card" data-remove="${item.id}" aria-label="Remove ${item.title}">remove</button><div class="cover-bottom"><div class="cover-title">${item.title}</div><div class="cover-creator">${item.creator}</div></div></div><div class="card-meta"><h3>${item.title}</h3><p>${item.creator}</p></div></article>`; }
function setView(view) { activeView = view; render(); }
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2300); }
function openModal() { $('#modalBackdrop').hidden = false; document.querySelector('[name="title"]').focus(); }
function closeModal() { $('#modalBackdrop').hidden = true; $('#mediaForm').reset(); }
document.addEventListener('click', (event) => { const viewButton = event.target.closest('[data-view], [data-filter]'); if (viewButton) setView(viewButton.dataset.view || viewButton.dataset.filter); const favorite = event.target.closest('[data-favorite]'); if (favorite) { const item = items.find((entry) => entry.id === Number(favorite.dataset.favorite)); item.favorite = !item.favorite; save(); render(); } const remove = event.target.closest('[data-remove]'); if (remove) { const item = items.find((entry) => entry.id === Number(remove.dataset.remove)); items = items.filter((entry) => entry.id !== Number(remove.dataset.remove)); save(); render(); showToast(`${item.title} removed from your shelf`); } });
$('#openModal').addEventListener('click', openModal); $('#closeModal').addEventListener('click', closeModal); $('#modalBackdrop').addEventListener('click', (event) => { if (event.target.id === 'modalBackdrop') closeModal(); });
$('#searchInput').addEventListener('input', (event) => { searchTerm = event.target.value; render(); });
$('#mediaForm').addEventListener('submit', (event) => { event.preventDefault(); const form = new FormData(event.target); const title = form.get('title').trim(); items.unshift({ id: Date.now(), title, creator: form.get('creator').trim(), type: form.get('type'), year: form.get('year') || '—', color: form.get('color'), favorite: false, added: new Date().toISOString().slice(0, 10) }); save(); closeModal(); setView('all'); showToast(`${title} is now on your shelf`); });
render();
